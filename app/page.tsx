"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, update, onValue, query, orderByChild, limitToLast, get, equalTo } from "firebase/database";

// ==========================================
// 1. AYARLAR & OYUN DENGESİ (V19.0 - SCROLL FIX)
// ==========================================
const CONFIG = {
  TILE_WIDTH: 128, TILE_HEIGHT: 64,
  MAP_SIZE: 60,
  ZOOM_MIN: 0.2, ZOOM_MAX: 1.5,
  OVERLAP_STRENGTH: 1.20,
  
  BASE_SPAWN_TIME: 25000, 
  BASE_WORK_TIME: 10000,  
  MIN_WORK_TIME: 2000,    
  DAY_CYCLE_DURATION: 60000,
  MANA_REGEN_RATE: 2, 

  // ORANLAR (Geyik ve Kaynak Dengesi)
  SPAWN_RATES: {
      tree: 0.35,   // Ağaç
      stone: 0.20,  // Taş
      deer: 0.35,   // %35 GEYİK (Bol Et)
      gold: 0.08,   // Altın
      chest: 0.02   // Sandık
  },

  RANKS: [
      { min: 0, title: "Sürgün", icon: "🍂", color: "#71717a" },
      { min: 1000, title: "Köylü", icon: "🥉", color: "#a1a1aa" },
      { min: 5000, title: "Şövalye", icon: "🥈", color: "#60a5fa" },
      { min: 15000, title: "Lord", icon: "🥇", color: "#facc15" },
      { min: 50000, title: "İMPARATOR", icon: "👑", color: "#ef4444" }
  ],

  UPGRADES: {
      tool: { 
          name: "Elmas Uçlar", icon: "⚒️", 
          desc: "Toplama hızını artırır.", baseCost: 150, mult: 1.6, 
          effectDesc: (lvl: number) => `Süre: -${(lvl * 0.8).toFixed(1)}sn`
      },
      nature: { 
          name: "Doğa Çağrısı", icon: "🌱", 
          desc: "Spawn hızını artırır.", baseCost: 300, mult: 1.7, 
          effectDesc: (lvl: number) => `Hız: %${(lvl * 10)} Artış`
      },
      speed: { 
          name: "Hermes Çizmesi", icon: "👟", 
          desc: "Yürüme hızı.", baseCost: 100, mult: 1.4, 
          effectDesc: (lvl: number) => `Hız: +%${lvl * 10}`
      },
      cap: { 
          name: "Şehir Yasası", icon: "📜", 
          desc: "Nüfus limiti.", baseCost: 500, mult: 2.0, 
          effectDesc: (lvl: number) => `Nüfus: +${(lvl+1) * 5}`
      }
  },

  ASSETS: {
    grass: '/assets/grass.png',
    water: '/assets/water.png',
    tree: '/assets/tree.png',
    stone: '/assets/stone.png',
    gold: '/assets/gold.png',
    deer: '/assets/deer.png',
    chest: '/assets/chest.png',
    house: '/assets/house.png',
    castle: '/assets/castle.png',
    worker: '/assets/worker.png',
    king: '/assets/king.png',
  }
};

const ACHIEVEMENTS_LIST = [
    { id: 'wood1k', name: 'Odun Kralı', desc: '1000 Odun Topla', icon: '🌲', target: 1000, type: 'wood' },
    { id: 'hunt100', name: 'Usta Avcı', desc: '100 Geyik Avla', icon: '🏹', target: 100, type: 'deer' },
    { id: 'gold500', name: 'Hazine Avcısı', desc: '500 Altın Topla', icon: '💎', target: 500, type: 'gold' },
    { id: 'score50k', name: 'İmparator', desc: '50.000 Puan Yap', icon: '👑', target: 50000, type: 'score' }
];

// ==========================================
// 2. FIREBASE
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyARP3ww_yz-hO6XOgZASuidFCDg1L7WDFo",
  authDomain: "treekingdom-61.firebaseapp.com",
  databaseURL: "https://treekingdom-61-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "treekingdom-61",
  storageBucket: "treekingdom-61.firebasestorage.app",
  messagingSenderId: "343363781693",
  appId: "1:343363781693:web:f4ff8a98e34bf9e1e21654",
  measurementId: "G-FL48K3S6ZP"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getDatabase(app);

const AssetManager = {
  images: {} as Record<string, HTMLImageElement>,
  loadAll() {
    Object.entries(CONFIG.ASSETS).forEach(([key, src]) => {
      const img = new Image();
      img.src = src;
      this.images[key] = img;
    });
  }
};

// ==========================================
// 3. OYUN MOTORU
// ==========================================
export default function GamePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const gs = useRef({
    map: [] as number[][],
    entities: [] as any[],
    particles: [] as any[],
    
    player: { 
        username: "", 
        pin: "",
        resources: { wood: 50, stone: 0, gold: 0, food: 60 }, 
        stats: { score: 0, totalWood: 0, totalDeer: 0, totalGold: 0 }, 
        upgrades: { tool: 0, nature: 0, speed: 0, cap: 0 },
        mana: 100, maxMana: 100,
        achievements: [] as string[],
        quest: { desc: "Görevi Al", target: 0, current: 0, type: 'wood', reward: 0, active: false },
        maxPop: 5 
    },
    camera: { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 0.5 },
    // HARİTA KAYDIRMA İÇİN GÜNCELLENMİŞ INPUT STATE
    input: { isDragging: false, startX: 0, startY: 0, lastX: 0, lastY: 0 },
    userId: null as string | null,
    isLoaded: false,
    lastTime: Date.now(),
    nextSpawnTime: Date.now() + CONFIG.BASE_SPAWN_TIME,
    timeOfDay: 0,
    spellActive: false
  });

  const [ui, setUi] = useState({ 
      res: gs.current.player.resources, 
      pop: 0, maxPop: 5, 
      nextSpawn: 30, 
      mana: 100, 
      quest: gs.current.player.quest 
  });
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loginModal, setLoginModal] = useState(false);
  const [techModal, setTechModal] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  const [usernameInput, setUsernameInput] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [buildMode, setBuildMode] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [upgradesUI, setUpgradesUI] = useState(gs.current.player.upgrades);

  const log = useCallback((msg: string) => setLogs(p => [`> ${msg}`, ...p].slice(0, 5)), []);

  useEffect(() => {
    AssetManager.loadAll();
    gs.current.isLoaded = true;

    // Harita
    const map = [];
    for(let x=0; x<CONFIG.MAP_SIZE; x++) {
      const row = [];
      for(let y=0; y<CONFIG.MAP_SIZE; y++) {
         const d = Math.sqrt((x-CONFIG.MAP_SIZE/2)**2 + (y-CONFIG.MAP_SIZE/2)**2);
         row.push(d > CONFIG.MAP_SIZE/2 - 3 ? 1 : 0);
      }
      map.push(row);
    }
    gs.current.map = map;

    const centerX = 0; 
    const centerY = (CONFIG.MAP_SIZE) * (CONFIG.TILE_HEIGHT/2);
    gs.current.camera.x = centerX; gs.current.camera.y = centerY;
    gs.current.camera.targetX = centerX; gs.current.camera.targetY = centerY;

    const savedUid = localStorage.getItem("orman_v19_uid");
    if (savedUid) {
        gs.current.userId = savedUid;
        connectToDb(savedUid);
    } else {
        setLoginModal(true);
    }

    const lbRef = query(ref(db, 'leaderboard'), orderByChild('score'), limitToLast(10));
    onValue(lbRef, (snap) => {
        const list: any[] = [];
        snap.forEach(c => { list.unshift(c.val()) });
        setLeaderboard(list);
    });

    let anim: number;
    const loop = () => {
      updateLogic();
      render();
      anim = requestAnimationFrame(loop);
    };
    anim = requestAnimationFrame(loop);
    
    const uiTimer = setInterval(() => {
        const timeLeft = Math.max(0, Math.ceil((gs.current.nextSpawnTime - Date.now()) / 1000));
        setUi(prev => ({
            ...prev, 
            nextSpawn: timeLeft,
            mana: Math.floor(gs.current.player.mana),
            quest: gs.current.player.quest
        }));
    }, 1000);

    const saveTimer = setInterval(saveGame, 5000);
    return () => { cancelAnimationFrame(anim); clearInterval(saveTimer); clearInterval(uiTimer); };
  }, []);

  const connectToDb = (uid: string) => {
      onValue(ref(db, `empires_final/${uid}`), (snap) => {
          const val = snap.val();
          if(val) {
              gs.current.player = {
                  ...gs.current.player,
                  ...val.player,
                  stats: val.player.stats || { score:0, totalWood:0, totalDeer:0, totalGold:0 },
                  achievements: val.player.achievements || [],
                  mana: val.player.mana || 100,
                  quest: val.player.quest || generateDailyQuest()
              };
              gs.current.entities = val.entities || [];
              updateUi();
          } else {
              initWorld(uid);
          }
      });
  };

  const generateDailyQuest = () => {
      const types = ['wood', 'stone', 'deer'];
      const type = types[Math.floor(Math.random()*types.length)];
      const target = type === 'wood' ? 500 : (type === 'stone' ? 100 : 20);
      const desc = type === 'wood' ? '500 Odun Topla' : (type === 'stone' ? '100 Taş Kır' : '20 Geyik Avla');
      return { desc, target, current: 0, type, reward: 1000, active: true };
  };

  const initWorld = (uid: string) => {
      const cx = Math.floor(CONFIG.MAP_SIZE/2);
      gs.current.entities = [{ id: 'castle', type: 'castle', pos: {x:cx, y:cx}, pixelPos: {x:0,y:0}, hp:5000, maxHp:5000, owner:uid }];
      gs.current.player.quest = generateDailyQuest();
      for(let i=0; i<30; i++) spawnRandomResource(true);
      saveGame();
      setShowTutorial(true);
  };

  const handleLogin = async () => {
      if(!usernameInput.trim() || pinInput.length !== 4) { setLoginError("Hatalı giriş."); return; }
      setLoginError("Kontrol ediliyor...");
      const cleanName = usernameInput.trim();
      const usersRef = ref(db, 'empires_final');
      const q = query(usersRef, orderByChild('player/username'), equalTo(cleanName));
      
      try {
          const snapshot = await get(q);
          if (snapshot.exists()) {
              let foundUid: string | null = null;
              let foundData: any = null;
              snapshot.forEach((child) => { foundUid = child.key; foundData = child.val(); });
              if (foundData && foundData.player.pin === pinInput) {
                  localStorage.setItem("orman_v19_uid", foundUid!);
                  gs.current.userId = foundUid;
                  setLoginModal(false);
                  connectToDb(foundUid!);
                  log(`Hoşgeldin İmparator ${cleanName}!`);
              } else { setLoginError("❌ Hatalı Şifre!"); }
          } else {
              const newUid = "u_" + Date.now() + Math.random().toString(36).substr(2,5);
              gs.current.player.username = cleanName;
              gs.current.player.pin = pinInput;
              gs.current.userId = newUid;
              localStorage.setItem("orman_v19_uid", newUid);
              setLoginModal(false);
              initWorld(newUid);
              log(`Yeni Krallık: ${cleanName}`);
          }
      } catch (error) { setLoginError("Bağlantı hatası."); }
  };

  const spawnRandomResource = (initial = false) => {
      const cx = Math.floor(CONFIG.MAP_SIZE/2);
      let found = false, attempt = 0;
      while(!found && attempt < 50) {
          const rx = Math.floor(Math.random()*CONFIG.MAP_SIZE);
          const ry = Math.floor(Math.random()*CONFIG.MAP_SIZE);
          const d = Math.sqrt((rx-CONFIG.MAP_SIZE/2)**2 + (ry-CONFIG.MAP_SIZE/2)**2);
          if(d < CONFIG.MAP_SIZE/2 - 3 && (Math.abs(rx-cx)>3 || Math.abs(ry-cx)>3)) {
              if(!gs.current.entities.find(e => e.pos.x === rx && e.pos.y === ry)) {
                   const r = Math.random();
                   let type = 'tree';
                   const S = CONFIG.SPAWN_RATES;
                   
                   if (r > (1 - S.chest)) type = 'chest'; 
                   else if (r > (1 - S.chest - S.gold)) type = 'gold'; 
                   else if (r > (1 - S.chest - S.gold - S.deer)) type = 'deer'; 
                   else if (r > (1 - S.chest - S.gold - S.deer - S.stone)) type = 'stone';
                   else type = 'tree';
                   
                   gs.current.entities.push({ id: `n_${Date.now()}_${attempt}`, type, pos: {x:rx, y:ry}, pixelPos: {x:0,y:0}, hp:100, maxHp:100, owner:'nature' });
                   found = true;
              }
          }
          attempt++;
      }
  };

  const buyUpgrade = (type: 'tool' | 'nature' | 'speed' | 'cap') => {
      const conf = CONFIG.UPGRADES[type];
      const lvl = gs.current.player.upgrades[type] || 0;
      if(lvl >= 10) return;
      const cost = Math.floor(conf.baseCost * Math.pow(conf.mult, lvl));
      if(gs.current.player.resources.wood >= cost) {
          gs.current.player.resources.wood -= cost;
          gs.current.player.upgrades[type]++;
          if(type === 'cap') gs.current.player.maxPop += 5;
          updateUi(); saveGame();
          log(`${conf.name} geliştirildi!`);
      } else { log(`Yetersiz Odun! (${cost} gerekli)`); }
  };

  const castSpell = (spell: 'speed' | 'nature') => {
      const p = gs.current.player;
      if(spell === 'speed') {
          if(p.mana >= 50) {
              p.mana -= 50;
              gs.current.spellActive = true;
              spawnFloatingText(0, 0, "⚡ HIZ BÜYÜSÜ!", "#3b82f6");
              setTimeout(() => { gs.current.spellActive = false; }, 10000);
          } else log("Yetersiz Mana (50)");
      }
      if(spell === 'nature') {
          if(p.mana >= 80) {
              p.mana -= 80;
              for(let i=0; i<15; i++) spawnRandomResource();
              spawnFloatingText(0, 0, "🌱 DOĞA BÜYÜSÜ!", "#22c55e");
          } else log("Yetersiz Mana (80)");
      }
      updateUi();
  };

  const updateUi = () => {
      setUi(prev => ({
          ...prev,
          res: {...gs.current.player.resources},
          pop: gs.current.entities.filter(e => (e.type === 'worker' || e.type === 'king') && e.owner === gs.current.userId).length,
          maxPop: gs.current.player.maxPop,
          mana: gs.current.player.mana,
          quest: gs.current.player.quest
      }));
      setUpgradesUI({...gs.current.player.upgrades});
  };

  const spawnFloatingText = (x: number, y: number, text: string, color: string) => {
      gs.current.particles.push({ x, y, text, color, life: 60, maxLife: 60, velocityY: 1.5 });
  };

  const checkAchievements = () => {
      const p = gs.current.player;
      ACHIEVEMENTS_LIST.forEach(ac => {
          if(!p.achievements.includes(ac.id)) {
              let val = 0;
              if(ac.type === 'wood') val = p.stats.totalWood;
              if(ac.type === 'deer') val = p.stats.totalDeer;
              if(ac.type === 'gold') val = p.stats.totalGold;
              if(ac.type === 'score') val = p.stats.score;

              if(val >= ac.target) {
                  p.achievements.push(ac.id);
                  spawnFloatingText(0, 0, `BAŞARIM: ${ac.name}`, "#f59e0b");
                  log(`🏆 Başarım Açıldı: ${ac.name}`);
              }
          }
      });
  };

  const updateQuest = (type: string, amount: number) => {
      const q = gs.current.player.quest;
      if(q && q.active && q.type === type) {
          q.current += amount;
          gs.current.player.quest.current = q.current; 
          
          if(q.current >= q.target) {
              q.active = false;
              gs.current.player.resources.gold += 100;
              gs.current.player.stats.score += q.reward;
              gs.current.player.quest = generateDailyQuest(); 
              spawnFloatingText(0, 0, "GÖREV TAMAMLANDI!", "#22c55e");
              log("Görev Bitti: +1000 Puan, +100 Altın");
          }
          updateUi();
      }
  };

  const saveGame = () => {
      if(!gs.current.userId) return;
      const p = gs.current.player;
      let score = 0;

      score += (p.resources.gold || 0) * 10;
      score += (p.resources.stone || 0) * 3;
      score += (p.resources.wood || 0) * 1;
      score += (p.resources.food || 0) * 1;

      gs.current.entities.forEach(e => {
          if (e.owner === gs.current.userId) {
              if (e.type === 'castle') score += 100; 
              if (e.type === 'house') score += 50;
              if (e.type === 'worker') score += 10 + ((e.level||1) * 10);
              if (e.type === 'king') score += 500;
          }
      });

      score += (p.upgrades.tool + p.upgrades.nature + p.upgrades.speed + p.upgrades.cap) * 150;
      score += (p.achievements.length * 1000);

      gs.current.player.stats.score = Math.floor(score);
      checkAchievements();

      const updates: any = {};
      updates[`empires_final/${gs.current.userId}`] = { player: gs.current.player, entities: gs.current.entities };
      updates[`leaderboard/${gs.current.userId}`] = { username: gs.current.player.username, score: Math.floor(score) };
      update(ref(db), updates);
  };

  const updateLogic = () => {
      const now = Date.now();
      gs.current.player.mana = Math.min(gs.current.player.maxMana, gs.current.player.mana + (CONFIG.MANA_REGEN_RATE / 60));

      gs.current.camera.x += (gs.current.camera.targetX - gs.current.camera.x) * 0.1;
      gs.current.camera.y += (gs.current.camera.targetY - gs.current.camera.y) * 0.1;

      if(now >= gs.current.nextSpawnTime) {
          spawnRandomResource();
          const natureLvl = gs.current.player.upgrades.nature || 0;
          gs.current.nextSpawnTime = now + (CONFIG.BASE_SPAWN_TIME * Math.pow(0.9, natureLvl));
      }

      gs.current.particles.forEach(p => { p.y -= p.velocityY; p.life--; });
      gs.current.particles = gs.current.particles.filter(p => p.life > 0);

      const king = gs.current.entities.find(e => e.type === 'king' && e.owner === gs.current.userId);

      gs.current.entities.forEach(ent => {
          const tx = (ent.pos.x - ent.pos.y) * (CONFIG.TILE_WIDTH / 2);
          const ty = (ent.pos.x + ent.pos.y) * (CONFIG.TILE_HEIGHT / 2);
          if(!ent.pixelPos) ent.pixelPos = {x: tx, y: ty};
          ent.pixelPos.x += (tx - ent.pixelPos.x) * 0.1;
          ent.pixelPos.y += (ty - ent.pixelPos.y) * 0.1;

          if(ent.owner === gs.current.userId) {
              if(ent.type === 'worker' || ent.type === 'king') {
                  if(!ent.level) ent.level = 1;

                  let isBuffed = gs.current.spellActive;
                  if(king && ent.type === 'worker') {
                      const distToKing = Math.hypot(ent.pos.x - king.pos.x, ent.pos.y - king.pos.y);
                      if(distToKing < 5) isBuffed = true;
                  }
                  ent.isBuffed = isBuffed;

                  if(ent.state === 'IDLE' && !ent.targetId) {
                      if(ent.type === 'king') return; 

                      let closest=null, min=999;
                      gs.current.entities.forEach(e => {
                          if((e.type==='tree'||e.type==='stone'||e.type==='gold'||e.type==='deer'||e.type==='chest') && e.hp>0) {
                              const d = Math.hypot(e.pos.x-ent.pos.x, e.pos.y-ent.pos.y);
                              if(d<min) { min=d; closest=e; }
                          }
                      });
                      if(closest && min<30) { ent.targetId = (closest as any).id; ent.state = 'MOVE'; }
                  }
                  else if(ent.state === 'MOVE' && (ent.targetId || ent.targetPos)) {
                      let tx, ty, dist;
                      if(ent.targetId) {
                          const t = gs.current.entities.find(e => e.id === ent.targetId);
                          if(t) { tx=t.pos.x; ty=t.pos.y; }
                          else { ent.state='IDLE'; ent.targetId=null; return; }
                      } else { tx=ent.targetPos.x; ty=ent.targetPos.y; }

                      const dx = tx - ent.pos.x;
                      const dy = ty - ent.pos.y;
                      dist = Math.hypot(dx, dy);

                      if(dist < 0.1) {
                          if(ent.type === 'king') { ent.state = 'IDLE'; ent.targetPos = null; } 
                          else { ent.state = 'WORK'; ent.workStartTime = Date.now(); }
                      } else {
                          const speedLvl = gs.current.player.upgrades.speed || 0;
                          let speed = 0.05 + (ent.level * 0.005) + (speedLvl * 0.01);
                          if(ent.isBuffed) speed *= 1.5; 
                          ent.pos.x += (dx/dist)*speed;
                          ent.pos.y += (dy/dist)*speed;
                      }
                  }
                  else if(ent.state === 'WORK' && ent.targetId) {
                      const t = gs.current.entities.find(e => e.id === ent.targetId);
                      if(t && t.hp > 0) {
                          const toolLvl = gs.current.player.upgrades.tool || 0;
                          let difficulty = t.type === 'gold' ? 2000 : 0;
                          if(t.type === 'chest') difficulty = -2000; 

                          let requiredTime = Math.max(CONFIG.MIN_WORK_TIME, CONFIG.BASE_WORK_TIME + difficulty - (toolLvl * 800));
                          if(ent.isBuffed) requiredTime /= 1.5; 

                          if(Date.now() - ent.workStartTime >= requiredTime) {
                              let val = 20 + (ent.level * 2);
                              let color = 'white';
                              
                              if(t.type==='tree') { 
                                  gs.current.player.resources.wood += val; color='#a3e635'; 
                                  gs.current.player.stats.totalWood += val;
                                  updateQuest('wood', val);
                                  spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 50, `+${val} Odun`, color);
                              }
                              if(t.type==='stone') { gs.current.player.resources.stone += val; color='#94a3b8'; updateQuest('stone', val); spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 50, `+${val} Taş`, color); }
                              if(t.type==='gold') { 
                                  gs.current.player.resources.gold += val; color='#facc15'; 
                                  gs.current.player.stats.totalGold += val;
                                  spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 50, `+${val} Altın`, color); 
                              }
                              if(t.type==='deer') { 
                                  let meat = val + 10; 
                                  gs.current.player.resources.food += meat; color='#fb923c'; 
                                  gs.current.player.stats.totalDeer += 1;
                                  updateQuest('deer', 1);
                                  spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 50, `+${meat} Et`, color); 
                              }
                              if(t.type==='chest') {
                                  let reward = Math.random() > 0.5 ? 500 : 2000;
                                  if(reward===500) { gs.current.player.resources.gold += 500; spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 60, `+500 ALTIN!`, '#facc15'); }
                                  else { gs.current.player.stats.score += 2000; spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 60, `+2000 PUAN!`, '#c084fc'); }
                              }
                              
                              ent.xp = (ent.xp||0) + 10;
                              if(ent.xp > ent.level*100) { ent.level++; spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 80, "LEVEL UP!", "#ef4444"); }

                              gs.current.entities = gs.current.entities.filter(e => e.id !== t.id);
                              ent.state='IDLE'; ent.targetId=null;
                              updateUi(); saveGame();
                          }
                      } else { ent.state='IDLE'; ent.targetId=null; }
                  }
              }
          }
      });
  };

  const getRank = (score: number) => {
      for(let i = CONFIG.RANKS.length-1; i >= 0; i--) { if(score >= CONFIG.RANKS[i].min) return CONFIG.RANKS[i]; }
      return CONFIG.RANKS[0];
  };

  // --- HARİTA KAYDIRMA (DRAG) FİXLENMİŞ INPUT HANDLER ---
  const handleInput = (e: any) => {
    const cx = e.clientX || e.touches?.[0]?.clientX;
    const cy = e.clientY || e.touches?.[0]?.clientY;
    
    if(e.type==='mousedown' || e.type==='touchstart') {
        gs.current.input.isDragging = false; 
        gs.current.input.startX = cx; gs.current.input.startY = cy;
        gs.current.input.lastX = cx; gs.current.input.lastY = cy;
    } 
    else if(e.type==='mousemove' || e.type==='touchmove') {
        if(e.buttons === 1 || e.type === 'touchmove') {
             const dist = Math.hypot(cx - gs.current.input.startX, cy - gs.current.input.startY);
             if(dist > 5) gs.current.input.isDragging = true; 

             if(gs.current.input.isDragging) {
                 gs.current.camera.targetX += (gs.current.input.lastX - cx);
                 gs.current.camera.targetY += (gs.current.input.lastY - cy);
             }
             gs.current.input.lastX = cx; gs.current.input.lastY = cy;
        }
    } 
    else if(e.type==='mouseup' || e.type==='touchend') {
        // Eğer sürükleme olmadıysa (sadece tıklama)
        if(!gs.current.input.isDragging && !buildMode) {
             const rect = canvasRef.current!.getBoundingClientRect();
             const mcx = (e.clientX || e.changedTouches?.[0]?.clientX) - rect.left;
             const mcy = (e.clientY || e.changedTouches?.[0]?.clientY) - rect.top;
             const adjX = mcx - canvasRef.current!.width/2 + gs.current.camera.x;
             const adjY = mcy - canvasRef.current!.height/2 + gs.current.camera.y;
             const halfW = (CONFIG.TILE_WIDTH * gs.current.camera.zoom) / 2;
             const halfH = (CONFIG.TILE_HEIGHT * gs.current.camera.zoom) / 2;
             const iy = Math.round((adjY/halfH - adjX/halfW) / 2);
             const ix = Math.round((adjY/halfH + adjX/halfW) / 2);
             
             const clickedEnt = gs.current.entities.find(en => en.pos.x === ix && en.pos.y === iy);
             if(!clickedEnt) {
                 const king = gs.current.entities.find(k => k.type === 'king' && k.owner === gs.current.userId);
                 if(king) { king.state = 'MOVE'; king.targetPos = {x:ix, y:iy}; king.targetId = null; }
             }
        } else if(buildMode && !gs.current.input.isDragging) {
             handleBuild(e);
        }
        gs.current.input.isDragging = false;
    }
  };

  const handleBuild = (e: any) => {
      if(!buildMode) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const cx = (e.clientX || e.changedTouches?.[0]?.clientX) - rect.left;
      const cy = (e.clientY || e.changedTouches?.[0]?.clientY) - rect.top;
      const adjX = cx - canvasRef.current!.width/2 + gs.current.camera.x;
      const adjY = cy - canvasRef.current!.height/2 + gs.current.camera.y;
      const halfW = (CONFIG.TILE_WIDTH * gs.current.camera.zoom) / 2;
      const halfH = (CONFIG.TILE_HEIGHT * gs.current.camera.zoom) / 2;
      const iy = Math.round((adjY/halfH - adjX/halfW) / 2);
      const ix = Math.round((adjY/halfH + adjX/halfW) / 2);

      const cost = buildMode==='house'?100:500;
      if(gs.current.player.resources.wood >= cost) {
          gs.current.player.resources.wood -= cost;
          gs.current.entities.push({ id: `b_${Date.now()}`, type: buildMode, pos: {x:ix, y:iy}, pixelPos:null, hp:500, maxHp:500, owner:gs.current.userId });
          setBuildMode(null); updateUi(); saveGame();
          spawnFloatingText(ix*CONFIG.TILE_WIDTH/2 - iy*CONFIG.TILE_WIDTH/2, (ix+iy)*CONFIG.TILE_HEIGHT/2, `-${cost} Odun`, 'red');
      } else { log("Kaynak Yetersiz"); }
  };

  const spawnUnit = (type: 'worker' | 'king') => {
      if(ui.pop >= ui.maxPop) { log("Nüfus Dolu!"); return; }
      const costFood = type==='worker' ? 60 : 0;
      const costGold = type==='king' ? 500 : 0;

      if(type==='king' && gs.current.entities.find(e => e.type==='king' && e.owner === gs.current.userId)) {
          log("Zaten bir Kralın var!"); return;
      }

      if(gs.current.player.resources.food >= costFood && gs.current.player.resources.gold >= costGold) {
          gs.current.player.resources.food -= costFood;
          gs.current.player.resources.gold -= costGold;
          const cx = Math.floor(CONFIG.MAP_SIZE/2);
          gs.current.entities.push({ id: `u_${Date.now()}`, type, pos: {x:cx, y:cx}, pixelPos:null, hp:100, maxHp:100, state:'IDLE', owner:gs.current.userId });
          updateUi(); saveGame(); 
          if(type==='worker') spawnFloatingText(0, (CONFIG.MAP_SIZE*CONFIG.TILE_HEIGHT)/2, "-60 Et", 'red');
          if(type==='king') spawnFloatingText(0, (CONFIG.MAP_SIZE*CONFIG.TILE_HEIGHT)/2, "KRAL GELDİ!", '#facc15');
      } else { log(`Yetersiz Kaynak (${type==='worker'?'60 Et':'500 Altın'})`); }
  };

  const handleZoom = (d: number) => {
      let z = gs.current.camera.zoom + d;
      gs.current.camera.zoom = Math.max(CONFIG.ZOOM_MIN, Math.min(CONFIG.ZOOM_MAX, z));
  };

  const render = () => {
    const cvs = canvasRef.current;
    if(!cvs || !cvs.getContext('2d')) return;
    const ctx = cvs.getContext('2d')!;
    if(cvs.width !== window.innerWidth) { cvs.width = window.innerWidth; cvs.height = window.innerHeight; }

    ctx.fillStyle = '#111827'; ctx.fillRect(0,0,cvs.width,cvs.height);

    const cam = gs.current.camera;
    const zoom = cam.zoom;
    const toScreen = (gx: number, gy: number) => ({
      x: (gx - gy) * (CONFIG.TILE_WIDTH/2) * zoom + cvs.width/2 - cam.x,
      y: (gx + gy) * (CONFIG.TILE_HEIGHT/2) * zoom + cvs.height/2 - cam.y
    });

    for(let x=0; x<CONFIG.MAP_SIZE; x++) {
        for(let y=0; y<CONFIG.MAP_SIZE; y++) {
            const pos = toScreen(x,y);
            if(pos.x<-200||pos.x>cvs.width+200||pos.y<-200||pos.y>cvs.height+200) continue;
            const type = gs.current.map[x][y];
            const img = type===1 ? AssetManager.images.water : AssetManager.images.grass;
            if(img && img.complete) {
                const w = CONFIG.TILE_WIDTH * zoom * CONFIG.OVERLAP_STRENGTH;
                const h = (img.height/img.width) * w;
                ctx.drawImage(img, pos.x - w/2, pos.y, w, h);
            }
        }
    }

    gs.current.entities.sort((a,b)=>(a.pos.x+a.pos.y)-(b.pos.x+b.pos.y));
    gs.current.entities.forEach(ent => {
        const pos = toScreen(ent.pos.x, ent.pos.y);
        const img = AssetManager.images[ent.type];
        if(img && img.complete) {
            const w = CONFIG.TILE_WIDTH * zoom;
            const h = (img.height/img.width) * w;
            const drawY = pos.y - h + (CONFIG.TILE_HEIGHT * zoom * 0.9);
            
            if(ent.isBuffed) {
                ctx.beginPath(); ctx.ellipse(pos.x, drawY + h - 10, w/3, w/6, 0, 0, Math.PI*2);
                ctx.fillStyle = "rgba(250, 204, 21, 0.4)"; ctx.fill();
            }

            ctx.drawImage(img, pos.x-w/2, drawY, w, h);

            if(ent.type === 'worker' || ent.type === 'king') {
                if(ent.type==='worker') { ctx.fillStyle='white'; ctx.font=`bold ${10*zoom}px Arial`; ctx.fillText(`Lvl ${ent.level||1}`, pos.x - 10, drawY); }
                if(ent.state === 'WORK') {
                    const barW = 40 * zoom;
                    ctx.fillStyle = '#333'; ctx.fillRect(pos.x - barW/2, drawY - 15, barW, 4);
                    ctx.fillStyle = '#fbbf24'; ctx.fillRect(pos.x - barW/2, drawY - 15, barW * (Date.now() - ent.workStartTime)/10000, 4);
                }
            }
        }
    });

    gs.current.particles.forEach(p => {
        const screenX = (p.x * zoom) + cvs.width/2 - cam.x; 
        const screenY = (p.y * zoom) + cvs.height/2 - cam.y;
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color; ctx.font = `bold ${16 * zoom}px Arial`;
        ctx.strokeText(p.text, screenX, screenY); ctx.fillText(p.text, screenX, screenY);
        ctx.globalAlpha = 1.0;
    });
  };

  return (
    <div className="fixed inset-0 bg-gray-900 text-white select-none overflow-hidden touch-none font-sans">
      
      {loginModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur">
            <div className="bg-slate-800 p-8 rounded-2xl w-80 text-center border border-white/10 shadow-2xl">
                <h2 className="text-3xl font-bold mb-4 text-emerald-400 font-serif tracking-widest">TREE KINGDOM</h2>
                <input type="text" placeholder="İmparator Adı" className="w-full bg-slate-900 p-3 rounded mb-2 border border-gray-600 outline-none text-white text-center"
                   value={usernameInput} onChange={e=>setUsernameInput(e.target.value)} maxLength={12} />
                <input type="password" placeholder="PIN" className="w-full bg-slate-900 p-3 rounded mb-4 border border-gray-600 outline-none text-white tracking-widest text-center"
                   value={pinInput} onChange={e=>setPinInput(e.target.value)} maxLength={4} inputMode="numeric" />
                {loginError && <div className="text-red-400 text-xs mb-3">{loginError}</div>}
                <button onClick={handleLogin} className="w-full bg-emerald-600 py-3 rounded font-bold hover:bg-emerald-500 shadow-lg">BAŞLA ⚔️</button>
            </div>
        </div>
      )}

      {/* TUTORIAL MODAL */}
      {showTutorial && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 rounded-2xl border border-emerald-500/30 w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in">
                <h2 className="text-2xl font-bold text-emerald-400 mb-4 text-center">HOŞGELDİN İMPARATOR! 👑</h2>
                <div className="space-y-3 text-sm text-gray-300">
                    <div className="flex items-center gap-3 bg-black/40 p-2 rounded">
                        <span className="text-2xl">🌲</span>
                        <p><strong>Amaç:</strong> Kaynak topla, İmparatorluğunu kur ve Liderlik tablosunda zirveye çık!</p>
                    </div>
                    <div className="flex items-center gap-3 bg-black/40 p-2 rounded">
                        <span className="text-2xl">👷</span>
                        <p><strong>İşçiler:</strong> Otomatik çalışırlar. "İşçi" butonuna basarak 60 ET karşılığında yenisini üret.</p>
                    </div>
                    <div className="flex items-center gap-3 bg-black/40 p-2 rounded">
                        <span className="text-2xl">🦌</span>
                        <p><strong>Geyikler:</strong> İşçi üretmek için ET kaynağıdır. Ormanda bolca bulunurlar.</p>
                    </div>
                    <div className="flex items-center gap-3 bg-black/40 p-2 rounded">
                        <span className="text-2xl">🤴</span>
                        <p><strong>Kral:</strong> 500 Altın ile üretilir. İşçilere HIZ verir. Tıkladığın yere yürür.</p>
                    </div>
                    <div className="flex items-center gap-3 bg-black/40 p-2 rounded">
                        <span className="text-2xl">⚔️</span>
                        <p><strong>Görevler:</strong> Aşağıdaki günlük görevleri yaparak puan ve altın kazan.</p>
                    </div>
                </div>
                <button onClick={()=>setShowTutorial(false)} className="w-full mt-6 bg-emerald-600 py-3 rounded-lg font-bold hover:bg-emerald-500 transition shadow-lg">KRALLIĞIMI YÖNETMEYE BAŞLA 🚀</button>
            </div>
        </div>
      )}

      {/* TECH MODAL */}
      {techModal && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 rounded-2xl border border-white/20 w-full max-w-lg p-6">
                <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
                    <h2 className="text-2xl font-bold text-purple-400">🧪 Teknoloji</h2>
                    <button onClick={()=>setTechModal(false)} className="text-red-400 font-bold">KAPAT</button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    {(['tool', 'nature', 'speed', 'cap'] as const).map(key => {
                        const conf = CONFIG.UPGRADES[key];
                        const lvl = upgradesUI[key] || 0;
                        const cost = Math.floor(conf.baseCost * Math.pow(conf.mult, lvl));
                        return (
                            <div key={key} className="bg-slate-800 p-4 rounded-xl border border-white/5">
                                <div className="text-2xl mb-1">{conf.icon}</div>
                                <div className="font-bold text-gray-200">{conf.name} <span className="text-xs text-gray-500">Lvl {lvl}</span></div>
                                <div className="text-xs text-green-400 mb-2">{conf.effectDesc(lvl)}</div>
                                <button onClick={()=>buyUpgrade(key)} className="w-full bg-slate-700 py-2 rounded text-xs">{lvl>=10?"MAX":`${cost} Odun`}</button>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
      )}

       {showAchievements && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 rounded-2xl border border-white/20 w-full max-w-lg p-6">
                <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
                    <h2 className="text-2xl font-bold text-yellow-400">🎖️ Başarımlar</h2>
                    <button onClick={()=>setShowAchievements(false)} className="text-red-400 font-bold">KAPAT</button>
                </div>
                <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto">
                    {ACHIEVEMENTS_LIST.map(ac => {
                        const unlocked = gs.current.player.achievements.includes(ac.id);
                        return (
                            <div key={ac.id} className={`p-3 rounded-lg border flex items-center gap-3 ${unlocked ? 'bg-yellow-900/20 border-yellow-500/50' : 'bg-slate-800 border-white/5 opacity-50'}`}>
                                <span className="text-2xl">{ac.icon}</span>
                                <div>
                                    <div className={`font-bold ${unlocked?'text-yellow-400':'text-gray-400'}`}>{ac.name}</div>
                                    <div className="text-xs text-gray-500">{ac.desc}</div>
                                </div>
                                {unlocked && <span className="ml-auto text-green-400 font-bold">✓</span>}
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
      )}

      {/* ÜST BAR */}
      <div className="absolute top-4 left-0 right-0 z-20 flex justify-center px-4">
          <div className="flex items-center gap-2">
             <div className="hidden md:block bg-black/60 px-3 py-2 rounded-lg border border-white/10 font-serif font-bold text-emerald-400 text-sm">TREE KINGDOM</div>
             <div className="flex gap-2 sm:gap-4 bg-black/70 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 shadow-xl overflow-hidden">
                <ResItem i="🌲" v={ui.res.wood} c="text-emerald-400" />
                <div className="w-px bg-white/10"></div>
                <ResItem i="🪨" v={ui.res.stone} c="text-stone-300" />
                <div className="w-px bg-white/10"></div>
                <ResItem i="💰" v={ui.res.gold} c="text-yellow-400" />
                <div className="w-px bg-white/10"></div>
                <ResItem i="🍗" v={ui.res.food} c="text-orange-400" />
                <div className="w-px bg-white/10"></div>
                <div className="flex flex-col items-center">
                   <span className="text-xs font-mono font-bold text-white">{ui.pop}/{ui.maxPop}</span>
                   <span className="text-[8px] text-gray-400">NÜFUS</span>
                </div>
             </div>
             <button onClick={() => setShowLeaderboard(!showLeaderboard)} className="w-10 h-10 rounded-full bg-black/60 border border-white/10 text-yellow-500">🏆</button>
             <button onClick={() => setShowAchievements(!showAchievements)} className="w-10 h-10 rounded-full bg-black/60 border border-white/10 text-orange-500">🎖️</button>
             <button onClick={() => setShowTutorial(true)} className="w-10 h-10 rounded-full bg-black/60 border border-white/10 text-emerald-400 font-bold text-xl">?</button>
          </div>
      </div>

      {showLeaderboard && (
          <div className="absolute top-16 right-4 z-30 bg-black/90 backdrop-blur-md p-4 rounded-xl border border-yellow-500/30 w-56 shadow-2xl">
              <div className="flex justify-between items-center border-b border-white/10 pb-2 mb-2">
                  <h3 className="text-yellow-400 font-bold text-xs">LİDER TABLOSU</h3>
                  <button onClick={()=>setShowLeaderboard(false)} className="text-gray-500">✕</button>
              </div>
              <div className="max-h-60 overflow-y-auto">
                  {leaderboard.map((p,i) => (
                    <div key={i} className="flex justify-between text-[10px] mb-2">
                        <span>{i+1}. {p.username.split('#')[0]}</span>
                        <span className="text-yellow-600 font-bold">{p.score}</span>
                    </div>
                  ))}
              </div>
          </div>
      )}

      {/* ALT MENÜ & MANA & GÖREV */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-auto z-20 w-full px-4">
          
          <div className="flex gap-2 w-full max-w-md justify-center">
               <div className="bg-black/60 px-3 py-1 rounded-full border border-blue-500/30 flex items-center gap-2">
                   <span className="text-xs text-blue-400 font-bold">MANA:</span>
                   <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden"><div className="h-full bg-blue-500" style={{width:`${ui.mana}%`}}></div></div>
               </div>
               {ui.quest.active && (
                   <div className="bg-black/60 px-3 py-1 rounded-full border border-green-500/30 text-[10px] text-green-300">
                       ⚔️ {ui.quest.desc} ({ui.quest.current}/{ui.quest.target})
                   </div>
               )}
          </div>

          <div className="bg-black/80 p-2 rounded-2xl border border-white/10 flex gap-1 sm:gap-2 backdrop-blur-sm shadow-xl overflow-x-auto">
            <Btn i="⚡" l="HIZ" sub="50 Mana" onClick={()=>castSpell('speed')} desc="İşçiler hızlanır" />
            <Btn i="🌱" l="DOĞA" sub="80 Mana" onClick={()=>castSpell('nature')} desc="Kaynak doğar" />
            <div className="w-px bg-white/20 mx-1"></div>
            <Btn i="👷" l="İşçi" sub="60 Et" onClick={()=>spawnUnit('worker')} desc="Kaynak toplar" />
            <Btn i="🤴" l="Kral" sub="500 Altın" onClick={()=>spawnUnit('king')} desc="Hız Aurası" />
            <div className="w-px bg-white/20 mx-1"></div>
            <Btn i="🏠" l="Ev" sub="100 Odun" onClick={()=>setBuildMode('house')} act={buildMode==='house'} desc="Dekor" />
            <Btn i="🧪" l="Tekno" sub="Yükselt" onClick={()=>setTechModal(true)} act={techModal} desc="Gelişim" />
          </div>
      </div>

      <div className="absolute top-24 left-4 flex flex-col gap-2 pointer-events-auto z-20">
          <button onClick={()=>handleZoom(0.1)} className="bg-slate-700 w-10 h-10 rounded text-xl font-bold border border-white/10">+</button>
          <button onClick={()=>handleZoom(-0.1)} className="bg-slate-700 w-10 h-10 rounded text-xl font-bold border border-white/10">-</button>
      </div>

      <div className="absolute bottom-4 left-4 pointer-events-none opacity-60 flex flex-col items-start gap-1 z-10 hidden sm:flex">
          {logs.map((l,i)=><div key={i} className="text-[10px] bg-black/60 px-2 py-1 rounded text-gray-200 border-l-2 border-blue-500">{l}</div>)}
      </div>

      <canvas ref={canvasRef} className="block w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleInput} onMouseMove={handleInput} onMouseUp={handleInput}
        onTouchStart={handleInput} onTouchMove={handleInput} onTouchEnd={handleInput}
        onWheel={(e)=>handleZoom(e.deltaY>0?-0.1:0.1)}
      />
    </div>
  );
}

const ResItem = ({i,v,c}:any) => (
    <div className="flex flex-col items-center min-w-[24px] sm:min-w-[36px]">
        <span className="text-lg sm:text-xl drop-shadow-md">{i}</span>
        <span className={`font-mono font-bold text-[10px] sm:text-xs ${c}`}>{Math.floor(v)}</span>
    </div>
);

const Btn = ({i,l,sub,onClick,act,desc}:any) => (
    <button onClick={onClick} className={`group relative flex flex-col items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-xl border transition-all active:scale-95 duration-200 ${act?'bg-purple-700 border-purple-500':'bg-transparent border-transparent hover:bg-white/10'}`}>
        <span className="text-xl sm:text-2xl">{i}</span>
        <span className="text-[8px] sm:text-[9px] uppercase font-bold mt-0.5 text-gray-300">{l}</span>
        <span className="text-[7px] sm:text-[8px] text-yellow-500 font-mono">{sub}</span>
    </button>
);
