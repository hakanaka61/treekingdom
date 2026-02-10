"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, update, onValue, query, orderByChild, limitToLast, get, equalTo } from "firebase/database";

// ==========================================
// 1. AYARLAR & OYUN DENGESİ (V29.0 FIXED)
// ==========================================
const CONFIG = {
  TILE_WIDTH: 128, TILE_HEIGHT: 64,
  MAP_SIZE: 80,
  ZOOM_MIN: 0.2, ZOOM_MAX: 1.5,
  OVERLAP_STRENGTH: 1.20,
  
  BASE_SPAWN_TIME: 25000, 
  FAST_SPAWN_TIME: 3000, 
  BASE_WORK_TIME: 10000,  
  MIN_WORK_TIME: 2000,    
  DAY_CYCLE_DURATION: 300000, // 5 DAKİKA
  MANA_REGEN_RATE: 0.5, 
  BASE_STORAGE: 500,

  BUILDINGS: {
      house: { name: "Köy Evi", cost: 100, res: 'wood', score: 50, desc: "Nüfus +5", scale: 1.3, hp: 500 },
      farm: { name: "Çiftlik", cost: 200, res: 'wood', score: 100, desc: "Pasif Yemek (+5)", scale: 1.3, hp: 400 },
      storage: { name: "Depo", cost: 400, res: 'wood', score: 150, desc: "Kapasite +1000", scale: 1.2, hp: 800 },
      barracks: { name: "Kışla", cost: 500, res: 'stone', score: 200, desc: "Asker Üretimi", scale: 1.5, hp: 1000 },
      tower: { name: "Kule", cost: 300, res: 'wood', score: 200, desc: "Pasif Altın (+10)", scale: 1.4, hp: 600 },
      castle: { name: "Kale", cost: 1000, res: 'wood', score: 5000, desc: "Merkez Üs", scale: 1.6, hp: 5000 }
  } as Record<string, any>,

  TRADES: [
      { id: 1, give: { type: 'wood', amount: 200 }, get: { type: 'gold', amount: 20 }, desc: "Odun Sat (200 -> 20 Altın)" },
      { id: 2, give: { type: 'stone', amount: 100 }, get: { type: 'gold', amount: 50 }, desc: "Taş Sat (100 -> 50 Altın)" },
      { id: 3, give: { type: 'gold', amount: 100 }, get: { type: 'wood', amount: 500 }, desc: "Odun Al (100 Altın -> 500 Odun)" }
  ],

  SCALE_FACTORS: {
      king: 1.8, castle: 1.6, house: 1.4, tower: 1.5, barracks: 1.5, farm: 1.3, storage: 1.2,
      worker: 0.9, soldier: 1.0, barbarian: 1.0,
      tree: 1.1, deer: 0.8, chest: 1.0, stone: 1.0, gold: 1.0
  } as Record<string, number>,

  SPAWN_RATES: { tree: 0.35, stone: 0.20, deer: 0.35, gold: 0.08, chest: 0.02 },

  RANKS: [
      { min: 0, title: "Sürgün", icon: "🍂", color: "#71717a" },
      { min: 1000, title: "Köylü", icon: "🥉", color: "#a1a1aa" },
      { min: 5000, title: "Şövalye", icon: "🥈", color: "#60a5fa" },
      { min: 15000, title: "Lord", icon: "🥇", color: "#facc15" },
      { min: 50000, title: "İMPARATOR", icon: "👑", color: "#ef4444" }
  ],

  UPGRADES: {
      tool: { name: "Elmas Uçlar", icon: "⚒️", desc: "Toplama hızı.", baseCost: 150, mult: 1.6, effectDesc: (lvl: number) => `Süre: -${(lvl * 0.8).toFixed(1)}sn` },
      nature: { name: "Doğa Çağrısı", icon: "🌱", desc: "Spawn hızı.", baseCost: 300, mult: 1.7, effectDesc: (lvl: number) => `Hız: %${(lvl * 10)} Artış` },
      speed: { name: "Hermes Çizmesi", icon: "👟", desc: "Yürüme hızı.", baseCost: 100, mult: 1.4, effectDesc: (lvl: number) => `Hız: +%${lvl * 10}` },
      cap: { name: "İmar İzni", icon: "📜", desc: "Ekstra Nüfus.", baseCost: 500, mult: 2.0, effectDesc: (lvl: number) => `Nüfus: +${(lvl+1) * 2}` },
      war: { name: "Savaş Sanatı", icon: "⚔️", desc: "Asker Gücü.", baseCost: 400, mult: 1.5, effectDesc: (lvl: number) => `Güç: +%${lvl * 20}` },
      wall: { name: "Duvarcılık", icon: "🧱", desc: "Bina Canı.", baseCost: 400, mult: 1.5, effectDesc: (lvl: number) => `HP: +%${lvl * 20}` }
  },

  // ASSETS ŞİMDİ CONFIG'İN İÇİNDE (HATA ÇÖZÜLDÜ)
  ASSETS: {
    grass: '/assets/grass.png', water: '/assets/water.png', tree: '/assets/tree.png',
    stone: '/assets/stone.png', gold: '/assets/gold.png', deer: '/assets/deer.png',
    chest: '/assets/chest.png', house: '/assets/house.png', castle: '/assets/castle.png',
    tower: '/assets/tower.png', worker: '/assets/worker.png', king: '/assets/king.png',
    barracks: '/assets/barracks.png', farm: '/assets/farm.png', storage: '/assets/storage.png',
    soldier: '/assets/soldier.png', barbarian: '/assets/barbarian.png'
  }
};

const ACHIEVEMENTS_LIST = [
    { id: 'wood1k', name: 'Odun Kralı', desc: '1000 Odun Topla', icon: '🌲', target: 1000, type: 'wood' },
    { id: 'hunt100', name: 'Usta Avcı', desc: '100 Geyik Avla', icon: '🏹', target: 100, type: 'deer' },
    { id: 'gold500', name: 'Hazine Avcısı', desc: '500 Altın Topla', icon: '💎', target: 500, type: 'gold' },
    { id: 'warrior', name: 'Savaşçı', desc: '10 Barbar Yok Et', icon: '⚔️', target: 10, type: 'kill' },
    { id: 'score50k', name: 'İmparator', desc: '50.000 Puan Yap', icon: '👑', target: 50000, type: 'score' }
];

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
      const img = new Image(); img.src = src; this.images[key] = img;
    });
  }
};

export default function GamePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const gs = useRef({
    map: [] as number[][], fog: [] as boolean[][], 
    entities: [] as any[], particles: [] as any[],
    player: { 
        username: "", pin: "", resources: { wood: 50, stone: 0, gold: 0, food: 60 }, 
        stats: { score: 0, totalWood: 0, totalDeer: 0, totalGold: 0, kills: 0 }, 
        upgrades: { tool: 0, nature: 0, speed: 0, cap: 0, war: 0, wall: 0 },
        mana: 100, maxMana: 100, achievements: [] as string[],
        quest: { desc: "Görevi Al", target: 0, current: 0, type: 'wood', reward: 0, active: false },
        maxPop: 5, heroLevel: 1, storageCap: CONFIG.BASE_STORAGE
    },
    camera: { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 0.5 },
    input: { isDragging: false, canClick: false, startX: 0, startY: 0, lastX: 0, lastY: 0 },
    userId: null as string | null, isLoaded: false, lastTime: Date.now(),
    nextSpawnTime: Date.now() + CONFIG.BASE_SPAWN_TIME, lastIncomeTime: Date.now(), lastEnemySpawn: Date.now(),
    timeOfDay: 0, spellActive: false, shieldActive: false,
    nightMode: false,
    timerText: "00:00"
  });

  const [ui, setUi] = useState({ 
      res: gs.current.player.resources, pop: 0, maxPop: 5, nextSpawn: 30, mana: 100, 
      quest: gs.current.player.quest, heroLvl: 1, cap: CONFIG.BASE_STORAGE,
      timer: "00:00", isNight: false
  });
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loginModal, setLoginModal] = useState(false);
  const [techModal, setTechModal] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [infoText, setInfoText] = useState("İmparatorluğunu Kur!");
  const [activeMenu, setActiveMenu] = useState<'none' | 'build' | 'magic' | 'market'>('none');
  const [hasKing, setHasKing] = useState(false);

  const [usernameInput, setUsernameInput] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [buildMode, setBuildMode] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [upgradesUI, setUpgradesUI] = useState(gs.current.player.upgrades);

  const log = useCallback((msg: string) => setLogs(p => [`> ${msg}`, ...p].slice(0, 5)), []);

  // --- 1. YARDIMCI FONKSİYONLAR (EN ÜSTTE) ---
  
  const updateUi = () => {
      setUi(prev => ({ 
          ...prev, res: {...gs.current.player.resources}, 
          pop: gs.current.entities.filter(e => (e.type === 'worker' || e.type === 'soldier' || e.type === 'king') && e.owner === gs.current.userId).length, 
          maxPop: gs.current.player.maxPop, mana: gs.current.player.mana, quest: gs.current.player.quest, heroLvl: gs.current.player.heroLevel || 1,
          cap: gs.current.player.storageCap
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
              if(ac.type === 'wood') val = p.stats.totalWood; if(ac.type === 'deer') val = p.stats.totalDeer;
              if(ac.type === 'gold') val = p.stats.totalGold; if(ac.type === 'score') val = p.stats.score;
              if(ac.type === 'kill') val = p.stats.kills || 0;
              if(val >= ac.target) { p.achievements.push(ac.id); spawnFloatingText(0, 0, `BAŞARIM: ${ac.name}`, "#f59e0b"); }
          }
      });
  };

  const generateDailyQuest = () => {
      const types = ['wood', 'stone', 'deer']; const type = types[Math.floor(Math.random()*types.length)];
      const target = type === 'wood' ? 500 : (type === 'stone' ? 100 : 20);
      const desc = type === 'wood' ? '500 Odun Topla' : (type === 'stone' ? '100 Taş Kır' : '20 Geyik Avla');
      return { desc, target, current: 0, type, reward: 1000, active: true };
  };

  const saveGame = () => {
      if(!gs.current.userId) return;
      const p = gs.current.player; let score = 0;
      score += (p.resources.gold || 0) * 10; score += (p.resources.stone || 0) * 3; score += (p.resources.wood || 0) * 1; score += (p.resources.food || 0) * 1;
      gs.current.entities.forEach(e => {
          if (e.owner === gs.current.userId) {
              if (e.type === 'castle') score += 100; if (e.type === 'house') score += 50; if (e.type === 'tower') score += 200;
              if (e.type === 'worker') score += 10 + ((e.level||1) * 10); if (e.type === 'king') score += 500;
              if (e.type === 'soldier') score += 50;
          }
      });
      score += (p.upgrades.tool + p.upgrades.nature + p.upgrades.speed + p.upgrades.cap) * 150; score += (p.achievements.length * 1000);
      score += (p.heroLevel || 1) * 200;
      gs.current.player.stats.score = Math.floor(score); checkAchievements();
      const updates: any = {};
      updates[`empires_final/${gs.current.userId}`] = { 
          player: gs.current.player, 
          entities: gs.current.entities,
          fog: gs.current.fog
      };
      updates[`leaderboard/${gs.current.userId}`] = { username: gs.current.player.username, score: Math.floor(score) };
      update(ref(db), updates);
  };

  const spawnRandomResource = (initial = false) => {
      const cx = Math.floor(CONFIG.MAP_SIZE/2);
      let found = false, attempt = 0;
      while(!found && attempt < 50) {
          const rx = Math.floor(Math.random()*CONFIG.MAP_SIZE); const ry = Math.floor(Math.random()*CONFIG.MAP_SIZE);
          const d = Math.sqrt((rx-CONFIG.MAP_SIZE/2)**2 + (ry-CONFIG.MAP_SIZE/2)**2);
          if(d < CONFIG.MAP_SIZE/2 - 3 && (Math.abs(rx-cx)>3 || Math.abs(ry-cx)>3)) {
              if(!gs.current.entities.find(e => e.pos.x === rx && e.pos.y === ry)) {
                   const r = Math.random(); let type = 'tree'; 
                   let nearWater = false;
                   if(rx>0 && rx<CONFIG.MAP_SIZE-1 && ry>0 && ry<CONFIG.MAP_SIZE-1) {
                       if(gs.current.map[rx+1][ry]===1 || gs.current.map[rx-1][ry]===1 || gs.current.map[rx][ry+1]===1 || gs.current.map[rx][ry-1]===1) nearWater = true;
                   }
                   const S = CONFIG.SPAWN_RATES;
                   if (r > (1 - S.chest)) type = 'chest'; else if (r > (1 - S.chest - S.gold)) type = 'gold'; 
                   else if (r > (1 - S.chest - S.gold - S.deer)) type = 'deer'; else if (r > (1 - S.chest - S.gold - S.deer - S.stone)) type = 'stone'; else type = 'tree';
                   if(nearWater && Math.random() < 0.8) type = 'tree'; 
                   gs.current.entities.push({ id: `n_${Date.now()}_${attempt}`, type, pos: {x:rx, y:ry}, pixelPos: {x:0,y:0}, hp:100, maxHp:100, owner:'nature' });
                   found = true;
              }
          } attempt++;
      }
  };

  const initWorld = (uid: string) => {
      const cx = Math.floor(CONFIG.MAP_SIZE/2);
      gs.current.entities = [{ id: 'castle', type: 'castle', pos: {x:cx, y:cx}, pixelPos: {x:0,y:0}, hp:5000, maxHp:5000, owner:uid }];
      gs.current.player.quest = generateDailyQuest();
      for(let x=cx-5; x<=cx+5; x++) for(let y=cx-5; y<=cx+5; y++) { if(x>=0 && x<CONFIG.MAP_SIZE && y>=0 && y<CONFIG.MAP_SIZE) gs.current.fog[x][y] = true; }
      for(let i=0; i<30; i++) spawnRandomResource(true);
      saveGame(); setShowTutorial(true);
  };

  // --- 2. VERİTABANI BAĞLANTISI ---
  const connectToDb = (uid: string) => {
      onValue(ref(db, `empires_final/${uid}`), (snap) => {
          const val = snap.val();
          if(val) {
              gs.current.player = { ...gs.current.player, ...val.player,
                  stats: val.player.stats || { score:0, totalWood:0, totalDeer:0, totalGold:0, kills:0 },
                  achievements: val.player.achievements || [], mana: val.player.mana || 100,
                  quest: val.player.quest || generateDailyQuest(),
                  heroLevel: val.player.heroLevel || 1,
                  storageCap: val.player.storageCap || CONFIG.BASE_STORAGE
              };
              gs.current.entities = val.entities || [];
              if(val.fog) gs.current.fog = val.fog;
              updateUi(); // ARTIK HATA VERMEZ, ÇÜNKÜ YUKARIDA TANIMLI
          } else { initWorld(uid); }
      });
  };

  // --- 3. DİĞER FONKSİYONLAR ---

  useEffect(() => {
    AssetManager.loadAll(); gs.current.isLoaded = true;
    const map = [], fog = [];
    for(let x=0; x<CONFIG.MAP_SIZE; x++) {
      const row = [], fogRow = [];
      for(let y=0; y<CONFIG.MAP_SIZE; y++) {
         const d = Math.sqrt((x-CONFIG.MAP_SIZE/2)**2 + (y-CONFIG.MAP_SIZE/2)**2);
         row.push(d > CONFIG.MAP_SIZE/2 - 3 ? 1 : 0);
         fogRow.push(false);
      }
      map.push(row); fog.push(fogRow);
    }
    gs.current.map = map; gs.current.fog = fog;
    const centerX = 0; const centerY = (CONFIG.MAP_SIZE) * (CONFIG.TILE_HEIGHT/2);
    gs.current.camera.x = centerX; gs.current.camera.y = centerY;
    gs.current.camera.targetX = centerX; gs.current.camera.targetY = centerY;

    const savedUid = localStorage.getItem("orman_v29_uid");
    if (savedUid) { gs.current.userId = savedUid; connectToDb(savedUid); } else { setLoginModal(true); }

    const lbRef = query(ref(db, 'leaderboard'), orderByChild('score'), limitToLast(10));
    onValue(lbRef, (snap) => { const list: any[] = []; snap.forEach(c => { list.unshift(c.val()) }); setLeaderboard(list); });

    let anim: number;
    const loop = () => { updateLogic(); render(); anim = requestAnimationFrame(loop); };
    anim = requestAnimationFrame(loop);
    
    const uiTimer = setInterval(() => {
        const timeLeft = Math.max(0, Math.ceil((gs.current.nextSpawnTime - Date.now()) / 1000));
        setUi(prev => ({ 
            ...prev, nextSpawn: timeLeft, mana: Math.floor(gs.current.player.mana), 
            quest: gs.current.player.quest, heroLvl: gs.current.player.heroLevel || 1,
            cap: gs.current.player.storageCap,
            timer: gs.current.timerText,
            isNight: gs.current.nightMode
        }));
        setHasKing(gs.current.entities.some(e => e.type === 'king' && e.owner === gs.current.userId));
    }, 1000);
    const saveTimer = setInterval(saveGame, 5000);
    return () => { cancelAnimationFrame(anim); clearInterval(saveTimer); clearInterval(uiTimer); };
  }, []);

  const handleLogin = async () => {
      if(!usernameInput.trim() || pinInput.length !== 4) { setLoginError("Hatalı giriş."); return; }
      setLoginError("Kontrol ediliyor...");
      const cleanName = usernameInput.trim();
      const usersRef = ref(db, 'empires_final');
      const q = query(usersRef, orderByChild('player/username'), equalTo(cleanName));
      try {
          const snapshot = await get(q);
          if (snapshot.exists()) {
              let foundUid: string | null = null; let foundData: any = null;
              snapshot.forEach((child) => { foundUid = child.key; foundData = child.val(); });
              if (foundData && foundData.player.pin === pinInput) {
                  localStorage.setItem("orman_v29_uid", foundUid!);
                  gs.current.userId = foundUid; setLoginModal(false); connectToDb(foundUid!);
              } else { setLoginError("❌ Hatalı Şifre!"); }
          } else {
              const newUid = "u_" + Date.now() + Math.random().toString(36).substr(2,5);
              gs.current.player.username = cleanName; gs.current.player.pin = pinInput; gs.current.userId = newUid;
              localStorage.setItem("orman_v29_uid", newUid); setLoginModal(false); initWorld(newUid);
          }
      } catch (error) { setLoginError("Bağlantı hatası."); }
  };

  const executeTrade = (tradeId: number) => {
      const trade = CONFIG.TRADES.find(t => t.id === tradeId);
      if(!trade) return;
      const p = gs.current.player;
      const resGive = trade.give.type as keyof typeof p.resources;
      const resGet = trade.get.type as keyof typeof p.resources;

      if(p.resources[resGive] >= trade.give.amount) {
          p.resources[resGive] -= trade.give.amount;
          p.resources[resGet] += trade.get.amount;
          spawnFloatingText(0,0, "Takas Başarılı!", "#facc15");
          updateUi(); saveGame();
      } else { setInfoText(`Yetersiz ${trade.give.type}!`); }
  };

  const buyUpgrade = (type: 'tool' | 'nature' | 'speed' | 'cap' | 'war' | 'wall') => {
      const conf = CONFIG.UPGRADES[type]; const lvl = gs.current.player.upgrades[type] || 0;
      if(lvl >= 10) return;
      const cost = Math.floor(conf.baseCost * Math.pow(conf.mult, lvl));
      if(gs.current.player.resources.wood >= cost) {
          gs.current.player.resources.wood -= cost; gs.current.player.upgrades[type]++;
          if(type === 'cap') gs.current.player.maxPop += 2;
          updateUi(); saveGame();
      } else { setInfoText(`Yetersiz Odun (${cost})`); }
  };

  const castSpell = (spell: 'speed' | 'nature' | 'shield' | 'goldrain') => {
      const p = gs.current.player;
      if(spell === 'speed') {
          if(p.mana >= 50) { p.mana -= 50; gs.current.spellActive = true; spawnFloatingText(0, 0, "⚡ HIZ BÜYÜSÜ!", "#3b82f6"); setTimeout(() => { gs.current.spellActive = false; }, 10000); } else setInfoText("Yetersiz Mana (50)");
      }
      if(spell === 'nature') {
          if(p.mana >= 80) { p.mana -= 80; for(let i=0; i<15; i++) spawnRandomResource(); spawnFloatingText(0, 0, "🌱 DOĞA BÜYÜSÜ!", "#22c55e"); } else setInfoText("Yetersiz Mana (80)");
      }
      if(spell === 'shield') {
          if(p.mana >= 100) { p.mana -= 100; gs.current.shieldActive = true; spawnFloatingText(0, 0, "🛡️ KALKAN!", "#60a5fa"); setTimeout(() => { gs.current.shieldActive = false; }, 15000); } else setInfoText("Yetersiz Mana (100)");
      }
      if(spell === 'goldrain') {
          if(p.mana >= 80) { p.mana -= 80; gs.current.player.resources.gold += 100; spawnFloatingText(0, 0, "💰 ALTIN YAĞMURU!", "#facc15"); } else setInfoText("Yetersiz Mana (80)");
      }
      updateUi();
  };

  const spawnUnit = (type: 'worker' | 'king' | 'upgrade_king' | 'soldier') => {
      if((type==='worker' || type==='soldier') && ui.pop >= ui.maxPop) { 
          setInfoText("Nüfus Dolu! Ev Yap."); 
          return; 
      }
      
      if(type === 'upgrade_king') {
          const currentLevel = gs.current.player.heroLevel || 1; 
          const upgradeCost = currentLevel * 500; 
          if(gs.current.player.resources.gold >= upgradeCost) { 
              gs.current.player.resources.gold -= upgradeCost; 
              gs.current.player.heroLevel = currentLevel + 1; 
              setInfoText(`Kral Seviye ${currentLevel + 1} Oldu!`); 
              spawnFloatingText(0,0, "LEVEL UP!", "#facc15"); 
              updateUi(); saveGame(); 
          } else { 
              setInfoText(`Yetersiz Altın: ${upgradeCost} Gerekli`); 
          }
          return;
      }

      const costFood = type==='worker' ? 60 : 0; 
      const costGold = (type==='king' ? 500 : (type==='soldier' ? 50 : 0)); 
      const costStone = type==='soldier' ? 20 : 0;

      if(type==='king' && gs.current.entities.find(e => e.type==='king' && e.owner === gs.current.userId)) { 
          setInfoText("Kralın Zaten Var!"); 
          return; 
      }
      
      if(gs.current.player.resources.food >= costFood && gs.current.player.resources.gold >= costGold && gs.current.player.resources.stone >= costStone) {
          gs.current.player.resources.food -= costFood; 
          gs.current.player.resources.gold -= costGold; 
          gs.current.player.resources.stone -= costStone;
          
          const cx = Math.floor(CONFIG.MAP_SIZE/2);
          gs.current.entities.push({ id: `u_${Date.now()}`, type, pos: {x:cx, y:cx}, pixelPos:null, hp:100, maxHp:100, state:'IDLE', owner:gs.current.userId });
          
          updateUi(); saveGame(); 
          if(type==='worker') spawnFloatingText(0, 0, "-60 Et", 'red');
          if(type==='soldier') spawnFloatingText(0, 0, "ASKER HAZIR!", 'gray');
          if(type==='king') { gs.current.player.heroLevel = 1; spawnFloatingText(0, 0, "KRAL GELDİ!", '#facc15'); }
      } else { 
          if(gs.current.player.resources.food < costFood) setInfoText(`Yetersiz Et (${costFood} Gerekli)`);
          else if(gs.current.player.resources.gold < costGold) setInfoText(`Yetersiz Altın (${costGold} Gerekli)`);
          else if(gs.current.player.resources.stone < costStone) setInfoText(`Yetersiz Taş (${costStone} Gerekli)`);
      }
  };

  const updateQuest = (type: string, amount: number) => {
      const q = gs.current.player.quest;
      if(q && q.active && q.type === type) {
          q.current += amount; gs.current.player.quest.current = q.current; 
          if(q.current >= q.target) {
              q.active = false; gs.current.player.resources.gold += 100; gs.current.player.stats.score += q.reward;
              gs.current.player.quest = generateDailyQuest(); spawnFloatingText(0, 0, "GÖREV TAMAMLANDI!", "#22c55e");
          } updateUi();
      }
  };

  const updateLogic = () => {
      const now = Date.now(); 
      gs.current.player.mana = Math.min(gs.current.player.maxMana, gs.current.player.mana + (CONFIG.MANA_REGEN_RATE / 60));
      
      const cycle = (now % CONFIG.DAY_CYCLE_DURATION) / CONFIG.DAY_CYCLE_DURATION;
      const isNight = cycle > 0.5;
      gs.current.nightMode = isNight;
      gs.current.timeOfDay = isNight ? 0.6 : 0;

      const totalSeconds = (CONFIG.DAY_CYCLE_DURATION / 1000);
      const remainingSeconds = isNight 
          ? Math.floor((1 - cycle) * totalSeconds) 
          : Math.floor((0.5 - cycle) * totalSeconds);
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      gs.current.timerText = `${isNight ? 'Gece' : 'Gündüz'} ${minutes}:${seconds < 10 ? '0'+seconds : seconds}`;

      if(isNight && now - gs.current.lastEnemySpawn > 10000) { 
          const myUnits = gs.current.entities.filter(e => (e.type === 'worker' || e.type === 'soldier' || e.type === 'king') && e.owner === gs.current.userId).length;
          
          if(myUnits >= 3) {
              const soldiers = gs.current.entities.filter(e => e.type === 'soldier' && e.owner === gs.current.userId).length;
              const spawnCount = 1 + Math.floor(soldiers / 2);
              
              for(let i=0; i<spawnCount; i++) {
                  const angle = Math.random() * Math.PI * 2;
                  const spawnX = Math.floor(CONFIG.MAP_SIZE/2 + Math.cos(angle) * 35);
                  const spawnY = Math.floor(CONFIG.MAP_SIZE/2 + Math.sin(angle) * 35);
                  if(spawnX>0 && spawnX<CONFIG.MAP_SIZE && spawnY>0 && spawnY<CONFIG.MAP_SIZE) {
                      gs.current.entities.push({ id: `enemy_${now}_${i}`, type: 'barbarian', pos: {x:spawnX, y:spawnY}, pixelPos:null, hp:100, maxHp:100, state:'MOVE', owner:'enemy' });
                  }
              }
              if(spawnCount > 0) spawnFloatingText(0,0, `${spawnCount} BARBAR SALDIRIYOR!`, "#ef4444");
          }
          gs.current.lastEnemySpawn = now;
      }

      if(now - gs.current.lastIncomeTime > 10000) {
          const towers = gs.current.entities.filter(e => e.type === 'tower' && e.owner === gs.current.userId).length;
          const farms = gs.current.entities.filter(e => e.type === 'farm' && e.owner === gs.current.userId).length;
          if(towers > 0) { gs.current.player.resources.gold += towers * 10; spawnFloatingText(0, 0, `+${towers * 10} Vergi`, '#facc15'); }
          if(farms > 0) { gs.current.player.resources.food += farms * 5; spawnFloatingText(0, 0, `+${farms * 5} Hasat`, '#fb923c'); }
          if(towers>0 || farms>0) updateUi();
          gs.current.lastIncomeTime = now;
      }

      gs.current.camera.x += (gs.current.camera.targetX - gs.current.camera.x) * 0.1; gs.current.camera.y += (gs.current.camera.targetY - gs.current.camera.y) * 0.1;
      
      const resourceCount = gs.current.entities.filter(e => e.owner === 'nature').length;
      const currentSpawnTime = resourceCount < 30 ? CONFIG.FAST_SPAWN_TIME : CONFIG.BASE_SPAWN_TIME;
      if(now >= gs.current.nextSpawnTime) { spawnRandomResource(); const natureLvl = gs.current.player.upgrades.nature || 0; gs.current.nextSpawnTime = now + (currentSpawnTime * Math.pow(0.9, natureLvl)); }
      
      gs.current.particles.forEach(p => { p.y -= p.velocityY; p.life--; }); gs.current.particles = gs.current.particles.filter(p => p.life > 0);
      const king = gs.current.entities.find(e => e.type === 'king' && e.owner === gs.current.userId);

      gs.current.entities.forEach(ent => {
          const tx = (ent.pos.x - ent.pos.y) * (CONFIG.TILE_WIDTH / 2); const ty = (ent.pos.x + ent.pos.y) * (CONFIG.TILE_HEIGHT / 2);
          if(!ent.pixelPos) ent.pixelPos = {x: tx, y: ty};
          ent.pixelPos.x += (tx - ent.pixelPos.x) * 0.1; ent.pixelPos.y += (ty - ent.pixelPos.y) * 0.1;

          if(ent.owner === gs.current.userId && ent.type !== 'tree' && ent.type !== 'stone') {
              const range = 4;
              for(let fx = Math.floor(ent.pos.x - range); fx <= Math.floor(ent.pos.x + range); fx++) {
                  for(let fy = Math.floor(ent.pos.y - range); fy <= Math.floor(ent.pos.y + range); fy++) {
                      if(fx>=0 && fx<CONFIG.MAP_SIZE && fy>=0 && fy<CONFIG.MAP_SIZE) gs.current.fog[fx][fy] = true;
                  }
              }
          }

          if(ent.type === 'barbarian') {
              let target: any = null; let minD = 999;
              gs.current.entities.forEach(t => {
                  if(t.owner === gs.current.userId && t.type !== 'barbarian' && t.type !== 'castle') {
                      const d = Math.hypot(t.pos.x - ent.pos.x, t.pos.y - ent.pos.y);
                      if(d < minD) { minD = d; target = t; }
                  }
              });

              if(target && minD < 1) { 
                  if(Math.random() < 0.05 && !gs.current.shieldActive) { 
                      target.hp -= 10;
                      spawnFloatingText(target.pixelPos.x, target.pixelPos.y, "-10 HP", "red");
                      if(target.hp <= 0) {
                          gs.current.entities = gs.current.entities.filter(e => e.id !== target.id);
                          spawnFloatingText(target.pixelPos.x, target.pixelPos.y, "YIKILDI!", "red");
                      }
                  }
              } else if(target) {
                  const dx = target.pos.x - ent.pos.x; const dy = target.pos.y - ent.pos.y;
                  ent.pos.x += (dx/minD)*0.03; ent.pos.y += (dy/minD)*0.03;
              }
          }

          if(ent.type === 'soldier') {
              let target: any = gs.current.entities.find(e => e.type === 'barbarian');
              if(target) {
                  const d = Math.hypot(target.pos.x - ent.pos.x, target.pos.y - ent.pos.y);
                  if(d < 1) {
                      if(Math.random() < 0.1) {
                          const warLvl = gs.current.player.upgrades.war || 0;
                          target.hp -= 20 + (warLvl * 5); 
                          spawnFloatingText(target.pixelPos.x, target.pixelPos.y, "⚔️", "white");
                          if(target.hp <= 0) {
                              gs.current.entities = gs.current.entities.filter(e => e.id !== target.id);
                              gs.current.player.stats.kills = (gs.current.player.stats.kills || 0) + 1;
                              spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y, "ZAFER!", "#facc15");
                              checkAchievements();
                          }
                      }
                  } else {
                      const dx = target.pos.x - ent.pos.x; const dy = target.pos.y - ent.pos.y;
                      ent.pos.x += (dx/d)*0.06; ent.pos.y += (dy/d)*0.06;
                  }
              }
          }

          if(ent.owner === gs.current.userId) {
              if(ent.type === 'worker' || ent.type === 'king') {
                  if(!ent.level) ent.level = 1;
                  let isBuffed = gs.current.spellActive; if(king && ent.type === 'worker') { const distToKing = Math.hypot(ent.pos.x - king.pos.x, ent.pos.y - king.pos.y); if(distToKing < 5) isBuffed = true; } ent.isBuffed = isBuffed;
                  if(ent.state === 'IDLE' && !ent.targetId) {
                      if(ent.type === 'king') return; 
                      let closest: any = null; let min = 999;
                      gs.current.entities.forEach(e => { 
                          if((e.type==='tree'||e.type==='stone'||e.type==='gold'||e.type==='deer'||e.type==='chest') && e.hp>0) { 
                              const d = Math.hypot(e.pos.x-ent.pos.x, e.pos.y-ent.pos.y); 
                              if(d<min) { min=d; closest=e; } 
                          } 
                      });
                      if(closest && min<50) { ent.targetId = (closest as any).id; ent.state = 'MOVE'; }
                  }
                  else if(ent.state === 'MOVE' && (ent.targetId || ent.targetPos)) {
                      let tx, ty, dist;
                      if(ent.targetId) { const t = gs.current.entities.find(e => e.id === ent.targetId); if(t) { tx=t.pos.x; ty=t.pos.y; } else { ent.state='IDLE'; ent.targetId=null; return; } } else { tx=ent.targetPos.x; ty=ent.targetPos.y; }
                      const dx = tx - ent.pos.x; const dy = ty - ent.pos.y; dist = Math.hypot(dx, dy);
                      if(dist < 0.1) { if(ent.type === 'king') { ent.state = 'IDLE'; ent.targetPos = null; } else { ent.state = 'WORK'; ent.workStartTime = Date.now(); } } 
                      else { const speedLvl = gs.current.player.upgrades.speed || 0; let speed = 0.05 + (ent.level * 0.005) + (speedLvl * 0.01); if(ent.isBuffed) speed *= (1.5 + ((gs.current.player.heroLevel||1)*0.1)); ent.pos.x += (dx/dist)*speed; ent.pos.y += (dy/dist)*speed; }
                  }
                  else if(ent.state === 'WORK' && ent.targetId) {
                      const t = gs.current.entities.find(e => e.id === ent.targetId);
                      if(t && t.hp > 0) {
                          const toolLvl = gs.current.player.upgrades.tool || 0; let difficulty = t.type === 'gold' ? 2000 : 0; if(t.type === 'chest') difficulty = -2000; 
                          let requiredTime = Math.max(CONFIG.MIN_WORK_TIME, CONFIG.BASE_WORK_TIME + difficulty - (toolLvl * 800)); if(ent.isBuffed) requiredTime /= (1.5 + ((gs.current.player.heroLevel||1)*0.1)); 
                          if(Date.now() - ent.workStartTime >= requiredTime) {
                              let val = 20 + (ent.level * 2); let color = 'white';
                              const currentRes = gs.current.player.resources; const cap = gs.current.player.storageCap || CONFIG.BASE_STORAGE;
                              if(t.type==='tree') { if(currentRes.wood < cap) { currentRes.wood += val; gs.current.player.stats.totalWood += val; updateQuest('wood', val); spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 50, `+${val} Odun`, '#a3e635'); } else spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 50, "DEPO DOLU!", "red"); }
                              if(t.type==='stone') { if(currentRes.stone < cap) { currentRes.stone += val; updateQuest('stone', val); spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 50, `+${val} Taş`, '#94a3b8'); } }
                              if(t.type==='gold') { currentRes.gold += val; gs.current.player.stats.totalGold += val; spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 50, `+${val} Altın`, '#facc15'); }
                              if(t.type==='deer') { let meat = val + 10; if(currentRes.food < cap) { currentRes.food += meat; gs.current.player.stats.totalDeer += 1; updateQuest('deer', 1); spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 50, `+${meat} Et`, '#fb923c'); } }
                              if(t.type==='chest') { let reward = Math.random() > 0.5 ? 500 : 2000; if(reward===500) { gs.current.player.resources.gold += 500; spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 60, `+500 ALTIN!`, '#facc15'); } else { gs.current.player.stats.score += 2000; spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 60, `+2000 PUAN!`, '#c084fc'); } }
                              ent.xp = (ent.xp||0) + 10; if(ent.xp > ent.level*100) { ent.level++; spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 80, "LEVEL UP!", "#ef4444"); }
                              gs.current.entities = gs.current.entities.filter(e => e.id !== t.id); ent.state='IDLE'; ent.targetId=null; updateUi(); saveGame();
                          }
                      } else { ent.state='IDLE'; ent.targetId=null; }
                  }
              }
          }
      });
  };

  const handleInput = (e: any) => {
    const getCoord = (evt: any) => { if(evt.touches && evt.touches.length > 0) return { x: evt.touches[0].clientX, y: evt.touches[0].clientY }; if(evt.changedTouches && evt.changedTouches.length > 0) return { x: evt.changedTouches[0].clientX, y: evt.changedTouches[0].clientY }; return { x: evt.clientX, y: evt.clientY }; };
    const { x: cx, y: cy } = getCoord(e);
    if(e.type==='mousedown' || e.type==='touchstart') { gs.current.input.isDragging = false; gs.current.input.canClick = true; gs.current.input.startX = cx; gs.current.input.startY = cy; gs.current.input.lastX = cx; gs.current.input.lastY = cy; } 
    else if(e.type==='mousemove' || e.type==='touchmove') {
        if(e.type === 'touchmove' || e.buttons === 1) {
             const dist = Math.hypot(cx - gs.current.input.startX, cy - gs.current.input.startY);
             if(dist > 10) { gs.current.input.isDragging = true; gs.current.input.canClick = false; }
             if(gs.current.input.isDragging) { gs.current.camera.targetX += (gs.current.input.lastX - cx) * 1.5; gs.current.camera.targetY += (gs.current.input.lastY - cy) * 1.5; }
             gs.current.input.lastX = cx; gs.current.input.lastY = cy;
        }
    } 
    else if(e.type==='mouseup' || e.type==='touchend') {
        if(gs.current.input.canClick && !buildMode) {
             const rect = canvasRef.current!.getBoundingClientRect(); const mcx = cx - rect.left; const mcy = cy - rect.top;
             const adjX = mcx - canvasRef.current!.width/2 + gs.current.camera.x; const adjY = mcy - canvasRef.current!.height/2 + gs.current.camera.y;
             const iy = Math.round((adjY/(CONFIG.TILE_HEIGHT*gs.current.camera.zoom/2) - adjX/(CONFIG.TILE_WIDTH*gs.current.camera.zoom/2)) / 2);
             const ix = Math.round((adjY/(CONFIG.TILE_HEIGHT*gs.current.camera.zoom/2) + adjX/(CONFIG.TILE_WIDTH*gs.current.camera.zoom/2)) / 2);
             const clickedEnt = gs.current.entities.find(en => en.pos.x === ix && en.pos.y === iy);
             if(!clickedEnt) { const king = gs.current.entities.find(k => k.type === 'king' && k.owner === gs.current.userId); if(king) { king.state = 'MOVE'; king.targetPos = {x:ix, y:iy}; king.targetId = null; setInfoText("Kral Yürüyor..."); } }
        } else if(buildMode && gs.current.input.canClick) { handleBuild({ clientX: cx, clientY: cy }); }
        gs.current.input.isDragging = false;
    }
  };

  const handleBuild = (e: any) => {
      if(!buildMode) return;
      const rect = canvasRef.current!.getBoundingClientRect(); const cx = (e.clientX || e.changedTouches?.[0]?.clientX) - rect.left; const cy = (e.clientY || e.changedTouches?.[0]?.clientY) - rect.top;
      const adjX = cx - canvasRef.current!.width/2 + gs.current.camera.x; const adjY = cy - canvasRef.current!.height/2 + gs.current.camera.y;
      const iy = Math.round((adjY/(CONFIG.TILE_HEIGHT*gs.current.camera.zoom/2) - adjX/(CONFIG.TILE_WIDTH*gs.current.camera.zoom/2)) / 2);
      const ix = Math.round((adjY/(CONFIG.TILE_HEIGHT*gs.current.camera.zoom/2) + adjX/(CONFIG.TILE_WIDTH*gs.current.camera.zoom/2)) / 2);
      const building = CONFIG.BUILDINGS[buildMode as keyof typeof CONFIG.BUILDINGS];
      const resType = building.res as keyof typeof gs.current.player.resources;
      if(gs.current.player.resources[resType] >= building.cost) {
          gs.current.player.resources[resType] -= building.cost;
          gs.current.entities.push({ id: `b_${Date.now()}`, type: buildMode, pos: {x:ix, y:iy}, pixelPos:null, hp:building.hp || 500, maxHp:building.hp || 500, owner:gs.current.userId });
          if(buildMode === 'house') gs.current.player.maxPop += 5; 
          if(buildMode === 'storage') gs.current.player.storageCap += 1000; 
          setBuildMode(null); setActiveMenu('none'); updateUi(); saveGame(); setInfoText("İnşaat Tamamlandı!");
          spawnFloatingText(ix*CONFIG.TILE_WIDTH/2 - iy*CONFIG.TILE_WIDTH/2, (ix+iy)*CONFIG.TILE_HEIGHT/2, `-${building.cost} ${building.res}`, 'red');
      } else { setInfoText(`Yetersiz Kaynak (${building.cost} ${building.res})`); }
  };

  const handleZoom = (d: number) => {
      let z = gs.current.camera.zoom + d;
      gs.current.camera.zoom = Math.max(CONFIG.ZOOM_MIN, Math.min(CONFIG.ZOOM_MAX, z));
  };

  const render = () => {
    const cvs = canvasRef.current; if(!cvs || !cvs.getContext('2d')) return; const ctx = cvs.getContext('2d')!;
    if(cvs.width !== window.innerWidth) { cvs.width = window.innerWidth; cvs.height = window.innerHeight; }
    ctx.fillStyle = '#111827'; ctx.fillRect(0,0,cvs.width,cvs.height);
    const cam = gs.current.camera; const zoom = cam.zoom;
    const toScreen = (gx: number, gy: number) => ({ x: (gx - gy) * (CONFIG.TILE_WIDTH/2) * zoom + cvs.width/2 - cam.x, y: (gx + gy) * (CONFIG.TILE_HEIGHT/2) * zoom + cvs.height/2 - cam.y });
    for(let x=0; x<CONFIG.MAP_SIZE; x++) { for(let y=0; y<CONFIG.MAP_SIZE; y++) { 
        const pos = toScreen(x,y); if(pos.x<-200||pos.x>cvs.width+200||pos.y<-200||pos.y>cvs.height+200) continue; 
        if(!gs.current.fog[x][y]) { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.moveTo(pos.x, pos.y); ctx.lineTo(pos.x+CONFIG.TILE_WIDTH*zoom/2, pos.y+CONFIG.TILE_HEIGHT*zoom/2); ctx.lineTo(pos.x, pos.y+CONFIG.TILE_HEIGHT*zoom); ctx.lineTo(pos.x-CONFIG.TILE_WIDTH*zoom/2, pos.y+CONFIG.TILE_HEIGHT*zoom/2); ctx.fill(); continue; }
        const type = gs.current.map[x][y]; const img = type===1 ? AssetManager.images.water : AssetManager.images.grass; if(img && img.complete) { const w = CONFIG.TILE_WIDTH * zoom * CONFIG.OVERLAP_STRENGTH; const h = (img.height/img.width) * w; ctx.drawImage(img, pos.x - w/2, pos.y, w, h); } 
    } }
    gs.current.entities.sort((a,b)=>(a.pos.x+a.pos.y)-(b.pos.x+b.pos.y));
    gs.current.entities.forEach(ent => {
        if(!gs.current.fog[Math.floor(ent.pos.x)][Math.floor(ent.pos.y)]) return;
        const pos = toScreen(ent.pos.x, ent.pos.y); const img = AssetManager.images[ent.type];
        if(img && img.complete) {
            const scale = CONFIG.SCALE_FACTORS[ent.type] || 1.0; const w = CONFIG.TILE_WIDTH * zoom * scale; const h = (img.height/img.width) * w; const drawY = pos.y - h + (CONFIG.TILE_HEIGHT * zoom * 0.9);
            if(ent.isBuffed) { ctx.beginPath(); ctx.ellipse(pos.x, drawY + h - 10, w/3, w/6, 0, 0, Math.PI*2); ctx.fillStyle = "rgba(250, 204, 21, 0.4)"; ctx.fill(); }
            ctx.drawImage(img, pos.x-w/2, drawY, w, h);
            if(ent.type === 'worker' || ent.type === 'king') {
                if(ent.type==='worker') { ctx.fillStyle='white'; ctx.font=`bold ${10*zoom}px Arial`; ctx.fillText(`Lvl ${ent.level||1}`, pos.x - 10, drawY); }
                if(ent.type==='king') { ctx.fillStyle='#facc15'; ctx.font=`bold ${12*zoom}px Arial`; ctx.fillText(`Lvl ${gs.current.player.heroLevel||1}`, pos.x - 12, drawY - 10); }
                if(ent.state === 'WORK') { const barW = 40 * zoom; ctx.fillStyle = '#333'; ctx.fillRect(pos.x - barW/2, drawY - 15, barW, 4); ctx.fillStyle = '#fbbf24'; ctx.fillRect(pos.x - barW/2, drawY - 15, barW * (Date.now() - ent.workStartTime)/10000, 4); }
            }
        }
    });
    if(gs.current.nightMode) { ctx.fillStyle = 'rgba(0, 0, 60, 0.4)'; ctx.fillRect(0,0,cvs.width, cvs.height); }
    gs.current.particles.forEach(p => { const screenX = (p.x * zoom) + cvs.width/2 - cam.x; const screenY = (p.y * zoom) + cvs.height/2 - cam.y; ctx.globalAlpha = p.life / p.maxLife; ctx.fillStyle = p.color; ctx.font = `bold ${16 * zoom}px Arial`; ctx.strokeText(p.text, screenX, screenY); ctx.fillText(p.text, screenX, screenY); ctx.globalAlpha = 1.0; });
  };

  return (
    <div className="fixed inset-0 bg-gray-900 text-white select-none overflow-hidden touch-none font-sans touch-none">
      {loginModal && ( <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur"> <div className="bg-slate-800 p-8 rounded-2xl w-80 text-center border border-white/10 shadow-2xl"> <h2 className="text-3xl font-bold mb-4 text-emerald-400 font-serif tracking-widest">TREE KINGDOM</h2> <input type="text" placeholder="İmparator Adı" className="w-full bg-slate-900 p-3 rounded mb-2 border border-gray-600 outline-none text-white text-center" value={usernameInput} onChange={e=>setUsernameInput(e.target.value)} maxLength={12} /> <input type="password" placeholder="PIN" className="w-full bg-slate-900 p-3 rounded mb-4 border border-gray-600 outline-none text-white tracking-widest text-center" value={pinInput} onChange={e=>setPinInput(e.target.value)} maxLength={4} inputMode="numeric" /> {loginError && <div className="text-red-400 text-xs mb-3">{loginError}</div>} <button onClick={handleLogin} className="w-full bg-emerald-600 py-3 rounded font-bold hover:bg-emerald-500 shadow-lg">BAŞLA ⚔️</button> </div> </div> )}
      {showTutorial && ( <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"> <div className="bg-slate-900 rounded-2xl border border-emerald-500/30 w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in"> <h2 className="text-2xl font-bold text-emerald-400 mb-4 text-center">HOŞGELDİN İMPARATOR! 👑</h2> <div className="space-y-3 text-sm text-gray-300"> <p>🌲 <strong>Amaç:</strong> Kaynak topla, İmparatorluğunu kur.</p> <p>🏠 <strong>Depo:</strong> Kaynak limitini artırmak için DEPO kur.</p> <p>⚔️ <strong>Savaş:</strong> Gece barbarlar gelir! Kışla kur ve ASKER üret.</p> <p>🌫️ <strong>Keşif:</strong> Harita karanlıktır, işçilerinle keşfet.</p> </div> <button onClick={()=>setShowTutorial(false)} className="w-full mt-6 bg-emerald-600 py-3 rounded-lg font-bold">ANLADIM</button> </div> </div> )}
      
      {showHelp && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 rounded-2xl border border-yellow-500/30 w-full max-w-lg p-6 shadow-2xl overflow-y-auto max-h-[80vh]">
                <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
                    <h2 className="text-xl font-bold text-yellow-400">OYUN REHBERİ 📜</h2>
                    <button onClick={()=>setShowHelp(false)} className="text-red-400 font-bold">KAPAT</button>
                </div>
                <div className="space-y-4 text-xs text-gray-300">
                    <div>
                        <h3 className="text-emerald-400 font-bold mb-1">BİRİMLER</h3>
                        <table className="w-full text-left">
                            <tbody>
                                <tr className="border-b border-white/5"><td>👷 İşçi</td><td>60 Et</td><td>Kaynak toplar.</td></tr>
                                <tr className="border-b border-white/5"><td>⚔️ Asker</td><td>50 Altın, 20 Taş</td><td>Barbarlara saldırır.</td></tr>
                                <tr><td>🤴 Kral</td><td>500 Altın</td><td>İşçileri hızlandırır. Seviye atlar.</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <div>
                        <h3 className="text-orange-400 font-bold mb-1">BİNALAR</h3>
                        <table className="w-full text-left">
                            <tbody>
                                <tr className="border-b border-white/5"><td>🏠 Ev</td><td>100 Odun</td><td>+5 Nüfus Limiti.</td></tr>
                                <tr className="border-b border-white/5"><td>🌾 Çiftlik</td><td>200 Odun</td><td>Otomatik Yemek üretir.</td></tr>
                                <tr className="border-b border-white/5"><td>📦 Depo</td><td>400 Odun</td><td>Kaynak limitini +1000 artırır.</td></tr>
                                <tr className="border-b border-white/5"><td>⚔️ Kışla</td><td>500 Taş</td><td>Asker üretmeni sağlar.</td></tr>
                                <tr><td>🗼 Kule</td><td>300 Odun</td><td>Otomatik Altın üretir.</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* ÜST BAR (SAYAÇLI) */}
      <div className="absolute top-4 left-0 right-0 z-20 flex justify-center px-4"> 
          <div className="flex flex-col items-center gap-1">
             <div className="bg-black/80 px-3 py-1 rounded-full border border-white/20 text-[10px] font-mono text-gray-300">
                 🕒 {ui.timer}
             </div>
             <div className="flex gap-2 sm:gap-4 bg-black/70 backdrop-blur-md px-4 py-2 rounded-full border border-yellow-500/20 shadow-xl overflow-hidden"> 
                <ResItem i="🌲" v={ui.res.wood} c="text-emerald-400" /> <div className="w-px bg-white/10"></div> 
                <ResItem i="🪨" v={ui.res.stone} c="text-stone-300" /> <div className="w-px bg-white/10"></div> 
                <ResItem i="💰" v={ui.res.gold} c="text-yellow-400" /> <div className="w-px bg-white/10"></div> 
                <ResItem i="🍗" v={ui.res.food} c="text-orange-400" /> <div className="w-px bg-white/10"></div> 
                <div className="flex flex-col items-center"> <span className="text-xs font-mono font-bold text-white">{ui.pop}/{ui.maxPop}</span> <span className="text-[8px] text-gray-400">NÜFUS</span> </div> 
             </div> 
             <div className="flex gap-2">
                <button onClick={() => setShowLeaderboard(!showLeaderboard)} className="w-8 h-8 rounded-full bg-black/60 border border-white/10 text-yellow-500 text-xs">🏆</button> 
                <button onClick={() => setShowAchievements(!showAchievements)} className="w-8 h-8 rounded-full bg-black/60 border border-white/10 text-orange-500 text-xs">🎖️</button> 
                <button onClick={() => setShowHelp(true)} className="w-8 h-8 rounded-full bg-black/60 border border-white/10 text-emerald-400 font-bold text-xs">?</button>
             </div>
          </div> 
      </div>
      
      {showLeaderboard && ( <div className="absolute top-24 right-4 z-30 bg-black/90 backdrop-blur-md p-4 rounded-xl border border-yellow-500/30 w-56 shadow-2xl"> <div className="flex justify-between items-center border-b border-white/10 pb-2 mb-2"> <h3 className="text-yellow-400 font-bold text-xs">LİDER TABLOSU</h3> <button onClick={()=>setShowLeaderboard(false)} className="text-gray-500">✕</button> </div> <div className="max-h-60 overflow-y-auto"> {leaderboard.map((p,i) => ( <div key={i} className="flex justify-between text-[10px] mb-2"> <span>{i+1}. {p.username.split('#')[0]}</span> <span className="text-yellow-600 font-bold">{p.score}</span> </div> ))} </div> </div> )}

      {/* ALT MENÜ (KOMPAKT) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-auto z-20 w-full px-2">
          <div className="bg-black/80 px-4 py-1 rounded-lg border border-yellow-500/30 text-[10px] text-yellow-100 font-bold mb-1 shadow-lg text-center min-w-[150px]"> {infoText} </div>
          <div className="flex gap-2 w-full max-w-md justify-center mb-1"> <div className="bg-black/60 px-2 py-1 rounded-full border border-blue-500/30 flex items-center gap-2"> <span className="text-[10px] text-blue-400 font-bold">MANA:</span> <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden"><div className="h-full bg-blue-500" style={{width:`${ui.mana}%`}}></div></div> </div> {ui.quest.active && ( <div className="bg-black/60 px-2 py-1 rounded-full border border-green-500/30 text-[10px] text-green-300"> ⚔️ {ui.quest.desc} </div> )} <div className="bg-black/60 px-2 py-1 rounded-full border border-orange-500/30 text-[10px] text-orange-300"> 📦 {Math.floor(ui.cap)} </div> </div>
          
          <div className="bg-black/90 p-1.5 rounded-xl border border-yellow-500/20 flex gap-1.5 backdrop-blur-sm shadow-2xl overflow-x-auto">
            <Btn i="🪄" l="BÜYÜ" onClick={()=>setActiveMenu(activeMenu==='magic'?'none':'magic')} act={activeMenu==='magic'} />
            <Btn i="🔨" l="YAPI" onClick={()=>setActiveMenu(activeMenu==='build'?'none':'build')} act={activeMenu==='build'} />
            <Btn i="⚖️" l="PAZAR" onClick={()=>setActiveMenu(activeMenu==='market'?'none':'market')} act={activeMenu==='market'} />
            <div className="w-px bg-white/20 mx-0.5"></div>
            <Btn i="👷" l="İŞÇİ" onClick={()=>{spawnUnit('worker'); setInfoText("Yeni İşçi! (-60 Et)");}} />
            <Btn i="⚔️" l="ASKER" onClick={()=>{spawnUnit('soldier'); setInfoText("Asker! (-50 Altın -20 Taş)");}} />
            <Btn i={hasKing ? "👑" : "🤴"} l={hasKing ? `Lvl ${ui.heroLvl}` : "KRAL"} onClick={()=>{spawnUnit(hasKing ? 'upgrade_king' : 'king'); setInfoText(hasKing ? `Terfi Et (Cost: ${ui.heroLvl*500}G)` : "Kral Çağır (500G)");}} act={hasKing} />
            <div className="w-px bg-white/20 mx-0.5"></div>
            <Btn i="🧪" l="TEKNO" onClick={()=>{setTechModal(true); setInfoText("Geliştirmeler");}} />
          </div>
      </div>

      <div className="absolute top-24 left-4 flex flex-col gap-2 pointer-events-auto z-20"> <button onClick={()=>handleZoom(0.1)} className="bg-slate-700 w-10 h-10 rounded text-xl font-bold border border-white/10">+</button> <button onClick={()=>handleZoom(-0.1)} className="bg-slate-700 w-10 h-10 rounded text-xl font-bold border border-white/10">-</button> </div>
      <canvas ref={canvasRef} className="block w-full h-full cursor-grab active:cursor-grabbing touch-none" onMouseDown={handleInput} onMouseMove={handleInput} onMouseUp={handleInput} onTouchStart={handleInput} onTouchMove={handleInput} onTouchEnd={handleInput} onWheel={(e)=>handleZoom(e.deltaY>0?-0.1:0.1)} />
    </div>
  );
}

const ResItem = ({i,v,c}:any) => ( <div className="flex flex-col items-center min-w-[24px] sm:min-w-[36px]"> <span className="text-lg sm:text-xl drop-shadow-md">{i}</span> <span className={`font-mono font-bold text-[10px] sm:text-xs ${c}`}>{Math.floor(v)}</span> </div> );
const Btn = ({i,l,onClick,act}:any) => ( <button onClick={onClick} className={`group flex flex-col items-center justify-center w-10 h-10 sm:w-14 sm:h-14 rounded-lg sm:rounded-xl border transition-all active:scale-95 duration-200 ${act?'bg-yellow-600 border-yellow-400 shadow-lg text-white':'bg-slate-800 border-white/10 text-gray-300 hover:bg-slate-700'}`}> <span className="text-lg sm:text-2xl mb-0.5">{i}</span> <span className="text-[8px] sm:text-[10px] font-bold">{l}</span> </button> );
