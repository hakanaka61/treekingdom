"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, update, onValue, push, query, orderByChild, limitToLast, get, equalTo } from "firebase/database";

// ==========================================
// 1. AYARLAR & OYUN DENGESİ (V35.0 FINAL)
// ==========================================
const CONFIG = {
  TILE_WIDTH: 128, TILE_HEIGHT: 64,
  MAP_SIZE: 80,
  ZOOM_MIN: 0.2, ZOOM_MAX: 1.5,
  OVERLAP_STRENGTH: 1.20,
  
  BASE_SPAWN_TIME: 20000, 
  FAST_SPAWN_TIME: 3000, 
  BASE_WORK_TIME: 10000,  
  MIN_WORK_TIME: 2000,    
  DAY_CYCLE_DURATION: 300000, // 5 DAKİKA
  NIGHT_DURATION_RATIO: 0.2, 
  MANA_REGEN_RATE: 0.5, 
  BASE_STORAGE: 1000,

  BUILDINGS: {
      house: { id:'house', name: "Köy Evi", cost: 100, res: 'wood', desc: "Nüfus +5", hp: 500, icon: "🏠" },
      farm: { id:'farm', name: "Çiftlik", cost: 200, res: 'wood', desc: "Pasif Yemek (+5)", hp: 400, icon: "🌾" },
      storage: { id:'storage', name: "Depo", cost: 400, res: 'wood', desc: "Kapasite +1000", hp: 800, icon: "📦" },
      barracks: { id:'barracks', name: "Kışla", cost: 500, res: 'stone', desc: "Asker Üretimi", hp: 1000, icon: "⚔️" },
      tower: { id:'tower', name: "Kule", cost: 300, res: 'wood', desc: "Pasif Altın (+10)", hp: 600, icon: "🗼" },
      castle: { id:'castle', name: "Kale", cost: 1000, res: 'wood', desc: "Merkez Üs", hp: 5000, icon: "🏰" }
  } as Record<string, any>,

  SPELLS: [
      { id: 'speed', name: "Rüzgarın Oğlu", mana: 50, desc: "Birimler 10sn %50 hızlanır.", icon: "⚡" },
      { id: 'nature', name: "Doğa Ana", mana: 80, desc: "Anında 15 kaynak doğar.", icon: "🌱" },
      { id: 'shield', name: "Kutsal Kalkan", mana: 100, desc: "15sn hasar almazsın.", icon: "🛡️" },
      { id: 'goldrain', name: "Bereket", mana: 80, desc: "Anında +200 Altın.", icon: "💰" }
  ],

  TRADES: [
      { id: 1, give: { type: 'wood', amount: 200 }, get: { type: 'gold', amount: 50 }, desc: "Odun Sat" },
      { id: 2, give: { type: 'stone', amount: 100 }, get: { type: 'gold', amount: 100 }, desc: "Taş Sat" },
      { id: 3, give: { type: 'gold', amount: 100 }, get: { type: 'wood', amount: 500 }, desc: "Odun Al" },
      { id: 4, give: { type: 'food', amount: 200 }, get: { type: 'stone', amount: 50 }, desc: "Yemek -> Taş" }
  ],

  TRADER_DEALS: [
      { id: 101, give: { type: 'gold', amount: 50 }, get: { type: 'wood', amount: 1000 }, desc: "Fırsat: Odun!" },
      { id: 102, give: { type: 'gold', amount: 50 }, get: { type: 'stone', amount: 500 }, desc: "Fırsat: Taş!" }
  ],

  SCALE_FACTORS: {
      king: 1.8, castle: 1.6, house: 1.4, tower: 1.5, barracks: 1.5, farm: 1.3, storage: 1.2,
      worker: 0.9, soldier: 1.0, barbarian: 1.0, trader: 1.2,
      tree: 1.1, deer: 0.8, chest: 1.0, stone: 1.0, gold: 1.0
  } as Record<string, number>,

  SPAWN_RATES: { tree: 0.35, stone: 0.20, deer: 0.35, gold: 0.08, chest: 0.02 },

  UPGRADES: {
      tool: { name: "Elmas Uçlar", icon: "⚒️", desc: "Toplama hızı.", baseCost: 150, mult: 1.6, effectDesc: (lvl: number) => `Süre: -${(lvl * 0.8).toFixed(1)}sn` },
      nature: { name: "Doğa Çağrısı", icon: "🌱", desc: "Spawn hızı.", baseCost: 300, mult: 1.7, effectDesc: (lvl: number) => `Hız: %${(lvl * 10)} Artış` },
      speed: { name: "Hermes Çizmesi", icon: "👟", desc: "Yürüme hızı.", baseCost: 100, mult: 1.4, effectDesc: (lvl: number) => `Hız: +%${lvl * 10}` },
      cap: { name: "İmar İzni", icon: "📜", desc: "Ekstra Nüfus.", baseCost: 500, mult: 2.0, effectDesc: (lvl: number) => `Nüfus: +${(lvl+1) * 2}` },
      war: { name: "Savaş Sanatı", icon: "⚔️", desc: "Asker Gücü.", baseCost: 400, mult: 1.5, effectDesc: (lvl: number) => `Güç: +%${lvl * 20}` },
      wall: { name: "Duvarcılık", icon: "🧱", desc: "Bina Canı.", baseCost: 400, mult: 1.5, effectDesc: (lvl: number) => `HP: +%${lvl * 20}` }
  },

  ASSETS: {
    grass: '/assets/grass.png', water: '/assets/water.png', tree: '/assets/tree.png',
    stone: '/assets/stone.png', gold: '/assets/gold.png', deer: '/assets/deer.png',
    chest: '/assets/chest.png', house: '/assets/house.png', castle: '/assets/castle.png',
    tower: '/assets/tower.png', worker: '/assets/worker.png', king: '/assets/king.png',
    barracks: '/assets/barracks.png', farm: '/assets/farm.png', storage: '/assets/storage.png',
    soldier: '/assets/soldier.png', barbarian: '/assets/barbarian.png', trader: '/assets/trader.png'
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
  
  // --- GAME STATE ---
  const gs = useRef({
    map: [] as number[][], fog: [] as boolean[][], 
    entities: [] as any[], particles: [] as any[], rain: [] as any[],
    player: { 
        username: "", pin: "", resources: { wood: 100, stone: 50, gold: 50, food: 100 }, 
        xp: 0, level: 1,
        stats: { score: 0, kills: 0, totalWood: 0, totalDeer: 0, totalGold: 0 }, 
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
    nightMode: false, weather: 'sunny',
    traderActive: false,
    timerText: "00:00"
  });

  // --- UI STATE ---
  const [ui, setUi] = useState({ 
      res: gs.current.player.resources, pop: 0, maxPop: 5, mana: 100, 
      level: 1, xp: 0, xpNext: 1000,
      quest: gs.current.player.quest,
      timer: "00:00", isNight: false, weather: 'sunny', trader: false
  });
  
  const [activeMenu, setActiveMenu] = useState<'none' | 'build' | 'magic' | 'market'>('none');
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [showQuestBox, setShowQuestBox] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [loginModal, setLoginModal] = useState(true);
  const [usernameInput, setUsernameInput] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [infoText, setInfoText] = useState("İmparatorluğunu Kur!");
  const [buildMode, setBuildMode] = useState<string | null>(null);
  const [upgradesUI, setUpgradesUI] = useState(gs.current.player.upgrades);
  
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [techModal, setTechModal] = useState(false);
  const [traderModal, setTraderModal] = useState(false);
  // FIX: hasKing STATE EKLENDI
  const [hasKing, setHasKing] = useState(false);

  const log = useCallback((msg: string) => {}, []);

  // --- 1. YARDIMCI FONKSİYONLAR ---
  
  const generateDailyQuest = () => {
      const types = ['wood', 'stone', 'deer']; const type = types[Math.floor(Math.random()*types.length)];
      const target = type === 'wood' ? 500 : (type === 'stone' ? 100 : 20);
      const desc = type === 'wood' ? '500 Odun Topla' : (type === 'stone' ? '100 Taş Kır' : '20 Geyik Avla');
      return { desc, target, current: 0, type, reward: 1000, active: true };
  };

  const spawnFloatingText = (x: number, y: number, text: string, color: string) => {
      gs.current.particles.push({ x, y, text, color, life: 60, maxLife: 60, velocityY: 1.5 });
  };

  const spawnParticle = (x: number, y: number, color: string) => {
      gs.current.particles.push({ x, y, text: ".", color, life: 30, maxLife: 30, velocityY: Math.random()*2, isDot: true });
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
              if(ac.type === 'kill') val = p.stats.kills || 0;
              if(val >= ac.target) { p.achievements.push(ac.id); spawnFloatingText(0, 0, `BAŞARIM: ${ac.name}`, "#f59e0b"); }
          }
      });
  };

  // --- 2. BAĞIMLI FONKSİYONLAR ---

  const updateUi = () => {
      const p = gs.current.player;
      const xpNeeded = p.level * 1000;
      setUi({
          res: {...p.resources},
          pop: gs.current.entities.filter(e => (e.type === 'worker' || e.type === 'soldier' || e.type === 'king') && e.owner === gs.current.userId && !e.dead).length,
          maxPop: p.maxPop, mana: Math.floor(p.mana),
          level: p.level, xp: p.xp, xpNext: xpNeeded,
          quest: p.quest,
          timer: gs.current.timerText,
          isNight: gs.current.nightMode,
          weather: gs.current.weather,
          trader: gs.current.traderActive
      });
      setUpgradesUI({...p.upgrades});
      // FIX: hasKing güncelleniyor
      setHasKing(gs.current.entities.some(e => e.type === 'king' && e.owner === gs.current.userId && !e.dead));
  };

  const saveGame = () => {
      if(!gs.current.userId) return;
      const p = gs.current.player; let score = 0;
      score += (p.resources.gold || 0) * 10; score += (p.resources.stone || 0) * 3; score += (p.resources.wood || 0) * 1; score += (p.resources.food || 0) * 1;
      const validEntities = gs.current.entities.filter(e => !e.dead);
      validEntities.forEach(e => {
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
          entities: validEntities,
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
          if(Math.hypot(rx-cx, ry-cx) < CONFIG.MAP_SIZE/2 - 3 && (Math.abs(rx-cx)>3 || Math.abs(ry-cx)>3)) {
              if(!gs.current.entities.find(e => !e.dead && e.pos.x === rx && e.pos.y === ry)) {
                   const r = Math.random(); let type = 'tree'; 
                   const S = CONFIG.SPAWN_RATES; 
                   if (r > (1 - 0.02)) type = 'chest'; else if (r > (1 - 0.1)) type = 'gold'; 
                   else if (r > (1 - 0.45)) type = 'deer'; else if (r > (1 - 0.65)) type = 'stone';
                   gs.current.entities.push({ id: `n_${Date.now()}_${attempt}`, type, pos: {x:rx, y:ry}, pixelPos: {x:0,y:0}, hp:100, maxHp:100, owner:'nature' });
                   found = true;
              }
          } attempt++;
      }
  };

  // --- 3. AUTO-REPAIR VE INIT ---

  const validateAndFixData = (val: any) => {
      if(!val.fog || val.fog.length !== CONFIG.MAP_SIZE) {
          const newFog: boolean[][] = [];
          for(let x=0; x<CONFIG.MAP_SIZE; x++) {
              const row: boolean[] = [];
              for(let y=0; y<CONFIG.MAP_SIZE; y++) row.push(false);
              newFog.push(row);
          }
          if(val.entities) {
              val.entities.forEach((e:any) => {
                  if(e.owner === gs.current.userId) {
                      for(let fx = Math.floor(e.pos.x - 4); fx <= Math.floor(e.pos.x + 4); fx++) {
                          for(let fy = Math.floor(e.pos.y - 4); fy <= Math.floor(e.pos.y + 4); fy++) {
                              if(fx>=0 && fx<CONFIG.MAP_SIZE && fy>=0 && fy<CONFIG.MAP_SIZE && newFog[fx]) newFog[fx][fy] = true;
                          }
                      }
                  }
              });
          }
          gs.current.fog = newFog;
      } else {
          gs.current.fog = val.fog;
      }

      const p = val.player || {};
      gs.current.player = {
          ...gs.current.player,
          username: p.username || "Oyuncu",
          pin: p.pin || "", 
          resources: p.resources || { wood: 100, stone: 50, gold: 50, food: 100 },
          xp: p.xp || 0,
          level: p.level || 1,
          stats: {
              score: p.stats?.score || 0,
              kills: p.stats?.kills || 0,
              totalWood: p.stats?.totalWood || 0,
              totalDeer: p.stats?.totalDeer || 0,
              totalGold: p.stats?.totalGold || 0
          },
          upgrades: p.upgrades || { tool: 0, nature: 0, speed: 0, cap: 0, war: 0, wall: 0 },
          mana: p.mana || 100,
          maxPop: p.maxPop || 5,
          storageCap: p.storageCap || CONFIG.BASE_STORAGE,
          quest: p.quest || generateDailyQuest()
      };

      gs.current.entities = (val.entities || []).filter((e:any) => !e.dead);
  };

  const initNewPlayer = (uid: string) => {
      const cx = Math.floor(CONFIG.MAP_SIZE/2);
      gs.current.entities = [{ id: 'castle', type: 'castle', pos: {x:cx, y:cx}, pixelPos: {x:0,y:0}, hp:5000, maxHp:5000, owner:uid }];
      gs.current.player.quest = generateDailyQuest();
      for(let x=cx-5; x<=cx+5; x++) for(let y=cx-5; y<=cx+5; y++) { 
          if(x>=0 && x<CONFIG.MAP_SIZE && y>=0 && y<CONFIG.MAP_SIZE && gs.current.fog[x]) gs.current.fog[x][y] = true; 
      }
      for(let i=0; i<30; i++) spawnRandomResource(true);
      saveGame();
  };

  const connectToDb = (uid: string) => {
      onValue(ref(db, `empires_final/${uid}`), (snap) => {
          const val = snap.val();
          if(val) {
              validateAndFixData(val); 
              updateUi();
          } else { 
              initNewPlayer(uid); 
          }
      });
  };

  useEffect(() => {
    AssetManager.loadAll(); gs.current.isLoaded = true;
    const map: number[][] = [], fog: boolean[][] = [];
    for(let x=0; x<CONFIG.MAP_SIZE; x++) {
      const row: number[] = [], fogRow: boolean[] = [];
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

    const savedUid = localStorage.getItem("orman_v35_uid");
    if (savedUid) { gs.current.userId = savedUid; connectToDb(savedUid); setLoginModal(false); }

    const lbRef = query(ref(db, 'leaderboard'), orderByChild('score'), limitToLast(10));
    onValue(lbRef, (snap) => { const list: any[] = []; snap.forEach(c => { list.unshift(c.val()) }); setLeaderboard(list); });

    let anim: number;
    const loop = () => { updateLogic(); render(); anim = requestAnimationFrame(loop); };
    anim = requestAnimationFrame(loop);
    
    const uiTimer = setInterval(() => {
        updateUi();
        checkDailyReward();
    }, 1000);

    return () => { cancelAnimationFrame(anim); clearInterval(uiTimer); };
  }, []);

  // --- LOGIN FUNCTION (FIXED) ---
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
                  localStorage.setItem("orman_v35_uid", foundUid!);
                  gs.current.userId = foundUid; connectToDb(foundUid!); setLoginModal(false);
              } else { setLoginError("Yanlış PIN"); }
          } else {
              const newUid = "u_" + Date.now() + Math.random().toString(36).substr(2,5);
              gs.current.player.username = cleanName; gs.current.player.pin = pinInput; gs.current.userId = newUid;
              localStorage.setItem("orman_v35_uid", newUid);
              initNewPlayer(newUid); setLoginModal(false);
          }
      } catch (error) { setLoginError("Bağlantı hatası."); }
  };

  // --- GAMEPLAY & RENDER ---

  const addXp = (amount: number) => {
      gs.current.player.xp += amount;
      const xpNeeded = gs.current.player.level * 1000;
      if(gs.current.player.xp >= xpNeeded) {
          gs.current.player.level++;
          gs.current.player.xp -= xpNeeded;
          gs.current.player.resources.gold += 500; 
          spawnFloatingText(0,0, `SEVİYE ATLADIN! (Lvl ${gs.current.player.level})`, "#facc15");
      }
  };

  const handleBuild = (key: string) => {
      setBuildMode(key); 
      setActiveMenu('none'); 
      setInfoText(`${CONFIG.BUILDINGS[key as keyof typeof CONFIG.BUILDINGS].name} için yer seç.`); 
  };

  const placeBuilding = (x: number, y: number) => {
      if(!buildMode) return;
      const b = CONFIG.BUILDINGS[buildMode as keyof typeof CONFIG.BUILDINGS];
      const res = b.res as keyof typeof gs.current.player.resources;
      
      if(gs.current.player.resources[res] >= b.cost) {
          gs.current.player.resources[res] -= b.cost;
          gs.current.entities.push({ 
              id: `b_${Date.now()}`, type: buildMode, pos: {x, y}, pixelPos: null, 
              hp: b.hp, maxHp: b.hp, owner: gs.current.userId 
          });
          
          if(buildMode === 'house') gs.current.player.maxPop += 5;
          if(buildMode === 'storage') gs.current.player.storageCap += 1000;
          
          addXp(50);
          setBuildMode(null);
          saveGame();
          setInfoText("İnşaat Başarılı!");
      } else {
          setInfoText(`Yetersiz ${b.res} (${b.cost} gerekli)`);
      }
  };

  const spawnUnit = (type: 'worker' | 'soldier' | 'king') => {
      const p = gs.current.player;
      if(type !== 'king' && ui.pop >= ui.maxPop) { setInfoText("Nüfus Dolu!"); return; }
      
      let cost: any = { wood:0, food:0, gold:0, stone:0 };
      if(type==='worker') cost.food = 60;
      if(type==='soldier') { cost.gold = 50; cost.stone = 20; }
      if(type==='king') cost.gold = 500;

      if(type==='king' && gs.current.entities.find(e => e.type==='king' && e.owner === gs.current.userId)) { setInfoText("Kralın Zaten Var!"); return; }
      
      if(p.resources.food >= cost.food && p.resources.gold >= cost.gold && p.resources.stone >= cost.stone) {
          p.resources.food -= cost.food; p.resources.gold -= cost.gold; p.resources.stone -= cost.stone;
          const cx = Math.floor(CONFIG.MAP_SIZE/2);
          gs.current.entities.push({ 
              id: `u_${Date.now()}`, type, pos: {x:cx, y:cx}, pixelPos: null, 
              hp: 100, maxHp: 100, state: 'IDLE', owner: gs.current.userId, level: 1 
          });
          setInfoText(`${type.toUpperCase()} Üretildi!`);
          saveGame();
      } else {
          setInfoText("Kaynak Yetersiz!");
      }
  };

  const castSpell = (spellId: string) => {
      const spell = CONFIG.SPELLS.find(s => s.id === spellId);
      if(!spell) return;
      if(gs.current.player.mana >= spell.mana) {
          gs.current.player.mana -= spell.mana;
          if(spellId === 'nature') { for(let i=0;i<10;i++) spawnRandomResource(); }
          if(spellId === 'goldrain') { gs.current.player.resources.gold += 200; }
          if(spellId === 'speed') { gs.current.spellActive = true; setTimeout(()=>gs.current.spellActive=false, 10000); }
          if(spellId === 'shield') { gs.current.shieldActive = true; setTimeout(()=>gs.current.shieldActive=false, 15000); }
          setInfoText(`${spell.name} yapıldı!`);
          saveGame();
      } else {
          setInfoText("Mana Yetersiz!");
      }
  };

  // FIX: buyUpgrade GERİ GELDİ
  const buyUpgrade = (key: any) => {
      const conf = CONFIG.UPGRADES[key as keyof typeof CONFIG.UPGRADES];
      const lvl = gs.current.player.upgrades[key as keyof typeof gs.current.player.upgrades] || 0;
      if(lvl >= 10) return;
      const cost = Math.floor(conf.baseCost * Math.pow(conf.mult, lvl));
      if(gs.current.player.resources.wood >= cost) {
          gs.current.player.resources.wood -= cost;
          gs.current.player.upgrades[key as keyof typeof gs.current.player.upgrades]++;
          if(key === 'cap') gs.current.player.maxPop += 2;
          updateUi(); saveGame();
          setInfoText(`${conf.name} Yükseltildi!`);
      } else { setInfoText(`Yetersiz Odun (${cost})`); }
  };

  const executeTrade = (tradeId: number) => {
      const trade = CONFIG.TRADES.find(t => t.id === tradeId) || CONFIG.TRADER_DEALS.find(t => t.id === tradeId);
      if(!trade) return;
      const p = gs.current.player;
      const give = trade.give.type as keyof typeof p.resources;
      const get = trade.get.type as keyof typeof p.resources;

      if(p.resources[give] >= trade.give.amount) {
          p.resources[give] -= trade.give.amount;
          p.resources[get] += trade.get.amount;
          saveGame();
          setInfoText("Takas Başarılı!");
      } else {
          setInfoText("Yetersiz Kaynak!");
      }
  };

  const sendChat = () => {
      if(!chatInput.trim()) return;
      const msg = { user: gs.current.player.username, text: chatInput, time: Date.now() };
      push(ref(db, 'global_chat'), msg);
      setChatInput("");
  };

  const checkDailyReward = () => {};

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
      if(gs.current.player.mana < gs.current.player.maxMana) gs.current.player.mana += 0.05;

      const cycle = (now % CONFIG.DAY_CYCLE_DURATION) / CONFIG.DAY_CYCLE_DURATION;
      gs.current.nightMode = cycle > (1 - CONFIG.NIGHT_DURATION_RATIO);
      const totalSec = CONFIG.DAY_CYCLE_DURATION / 1000;
      const remSec = Math.floor((gs.current.nightMode ? (1-cycle) : ((1-CONFIG.NIGHT_DURATION_RATIO)-cycle)) * totalSec);
      gs.current.timerText = `${gs.current.nightMode ? '🌙 Gece' : '☀️ Gündüz'} ${Math.floor(remSec/60)}:${(remSec%60).toString().padStart(2,'0')}`;

      if(Math.random() < 0.001) gs.current.weather = gs.current.weather === 'sunny' ? 'rain' : 'sunny';

      if(!gs.current.nightMode && Math.random() < 0.0005 && !gs.current.traderActive) {
          gs.current.traderActive = true;
          spawnFloatingText(0,0, "TÜCCAR GELDİ!", "#d946ef");
          setTimeout(() => { gs.current.traderActive = false; spawnFloatingText(0,0, "Tüccar Gitti...", "#d946ef"); updateUi(); }, 30000); 
          updateUi();
      }

      if(now > gs.current.nextSpawnTime) { spawnRandomResource(); gs.current.nextSpawnTime = now + CONFIG.BASE_SPAWN_TIME; }

      if(gs.current.nightMode && now - gs.current.lastEnemySpawn > 10000) {
          const soldiers = gs.current.entities.filter(e => e.type === 'soldier' && e.owner === gs.current.userId).length;
          if(soldiers > 0 || Math.random() < 0.3) { 
             const angle = Math.random() * Math.PI * 2;
             const sx = Math.floor(CONFIG.MAP_SIZE/2 + Math.cos(angle)*30);
             const sy = Math.floor(CONFIG.MAP_SIZE/2 + Math.sin(angle)*30);
             gs.current.entities.push({ id: `e_${now}`, type: 'barbarian', pos:{x:sx, y:sy}, pixelPos:null, hp:100, maxHp:100, state:'MOVE', owner:'enemy' });
             gs.current.lastEnemySpawn = now;
             setInfoText("Barbarlar Yaklaşıyor!");
          }
      }

      if(now - gs.current.lastIncomeTime > 10000) {
          const towers = gs.current.entities.filter(e => e.type === 'tower' && e.owner === gs.current.userId && !e.dead).length;
          const farms = gs.current.entities.filter(e => e.type === 'farm' && e.owner === gs.current.userId && !e.dead).length;
          let farmBonus = gs.current.weather === 'rain' ? 2 : 1; 
          if(towers > 0) { gs.current.player.resources.gold += towers * 10; spawnFloatingText(0, 0, `+${towers * 10} Vergi`, '#facc15'); }
          if(farms > 0) { gs.current.player.resources.food += farms * 5 * farmBonus; spawnFloatingText(0, 0, `+${farms * 5 * farmBonus} Hasat`, '#fb923c'); }
          if(towers>0 || farms>0) updateUi();
          gs.current.lastIncomeTime = now;
      }

      gs.current.camera.x += (gs.current.camera.targetX - gs.current.camera.x) * 0.1; 
      gs.current.camera.y += (gs.current.camera.targetY - gs.current.camera.y) * 0.1;

      gs.current.entities.forEach(ent => {
          if(!ent.pixelPos) ent.pixelPos = { x: (ent.pos.x - ent.pos.y) * 64, y: (ent.pos.x + ent.pos.y) * 32 };
          const tx = (ent.pos.x - ent.pos.y) * 64; const ty = (ent.pos.x + ent.pos.y) * 32;
          ent.pixelPos.x += (tx - ent.pixelPos.x) * 0.1; ent.pixelPos.y += (ty - ent.pixelPos.y) * 0.1;

          if(ent.type === 'worker' && ent.owner === gs.current.userId) {
              if(ent.state === 'IDLE') {
                  const target = gs.current.entities.find(e => (e.type==='tree'||e.type==='stone'||e.type==='gold') && !e.dead);
                  if(target) { ent.targetId = target.id; ent.state = 'MOVE'; }
              }
              if(ent.state === 'MOVE' && ent.targetId) {
                  const t = gs.current.entities.find(e => e.id === ent.targetId);
                  if(t) {
                      const d = Math.hypot(t.pos.x - ent.pos.x, t.pos.y - ent.pos.y);
                      if(d < 0.5) { ent.state = 'WORK'; ent.workStart = now; }
                      else { 
                          const speed = 0.05 * (gs.current.spellActive ? 1.5 : 1);
                          ent.pos.x += (t.pos.x - ent.pos.x)/d * speed; 
                          ent.pos.y += (t.pos.y - ent.pos.y)/d * speed; 
                      }
                  } else { ent.state = 'IDLE'; }
              }
              if(ent.state === 'WORK' && ent.targetId) {
                  const t = gs.current.entities.find(e => e.id === ent.targetId);
                  if(t && now - ent.workStart > 3000) { 
                      if(t.type === 'tree') { gs.current.player.resources.wood += 20; gs.current.player.stats.totalWood += 20; }
                      if(t.type === 'stone') { gs.current.player.resources.stone += 20; }
                      if(t.type === 'gold') { gs.current.player.resources.gold += 20; gs.current.player.stats.totalGold += 20; }
                      if(t.type === 'deer') gs.current.player.stats.totalDeer += 1;

                      addXp(10);
                      updateQuest(t.type, 20); 
                      t.dead = true; 
                      ent.state = 'IDLE';
                      saveGame();
                  }
              }
          }
      });

      gs.current.entities = gs.current.entities.filter(e => !e.dead);
  };

  const render = () => {
      const cvs = canvasRef.current; if(!cvs) return; const ctx = cvs.getContext('2d'); if(!ctx) return;
      cvs.width = window.innerWidth; cvs.height = window.innerHeight;
      ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0,0,cvs.width,cvs.height);

      const cam = gs.current.camera;
      const zoom = cam.zoom;
      const isoX = (x:number, y:number) => (x - y) * (CONFIG.TILE_WIDTH/2) * zoom + cvs.width/2 - cam.x;
      const isoY = (x:number, y:number) => (x + y) * (CONFIG.TILE_HEIGHT/2) * zoom + cvs.height/2 - cam.y;

      for(let x=0; x<CONFIG.MAP_SIZE; x++) {
          for(let y=0; y<CONFIG.MAP_SIZE; y++) {
              if(gs.current.fog[x] && !gs.current.fog[x][y]) continue; 
              const px = isoX(x,y); const py = isoY(x,y);
              if(px < -100 || px > cvs.width+100 || py < -100 || py > cvs.height+100) continue; 

              const img = gs.current.map[x][y] === 1 ? AssetManager.images.water : AssetManager.images.grass;
              if(img) ctx.drawImage(img, px - (64*zoom), py, 128*zoom, 64*zoom);
          }
      }

      gs.current.entities.sort((a,b) => (a.pos.x + a.pos.y) - (b.pos.x + b.pos.y));
      gs.current.entities.forEach(e => {
          const ix = Math.floor(e.pos.x); const iy = Math.floor(e.pos.y);
          if(!gs.current.fog[ix] || !gs.current.fog[ix][iy]) return;

          const px = isoX(e.pos.x, e.pos.y); const py = isoY(e.pos.x, e.pos.y);
          const img = AssetManager.images[e.type];
          if(img) {
              const h = (img.height/img.width) * (128*zoom) * (CONFIG.SCALE_FACTORS[e.type] || 1);
              ctx.drawImage(img, px - (64*zoom), py - h + (32*zoom), 128*zoom * (CONFIG.SCALE_FACTORS[e.type] || 1), h);
              if(e.state === 'IDLE') ctx.fillText("💤", px, py - h);
              if(e.state === 'WORK') ctx.fillText("🔨", px, py - h);
          }
      });

      if(gs.current.nightMode) { ctx.fillStyle = 'rgba(60, 0, 0, 0.3)'; ctx.fillRect(0,0,cvs.width, cvs.height); }
      if(gs.current.weather === 'rain') { ctx.fillStyle = 'rgba(100,100,255,0.1)'; ctx.fillRect(0,0,cvs.width,cvs.height); }
      
      gs.current.particles.forEach(p => { 
          const screenX = (p.x * zoom) + cvs.width/2 - cam.x; 
          const screenY = (p.y * zoom) + cvs.height/2 - cam.y; 
          ctx.globalAlpha = p.life / p.maxLife; ctx.fillStyle = p.color; ctx.font = `bold ${16 * zoom}px Arial`; 
          ctx.fillText(p.text, screenX, screenY); 
          ctx.globalAlpha = 1.0; 
      });
  };

  const handleInput = (e: any) => {
      const x = e.clientX || e.touches?.[0]?.clientX;
      const y = e.clientY || e.touches?.[0]?.clientY;
      if(!x) return;

      if(e.type === 'mousedown' || e.type === 'touchstart') {
          gs.current.input.startX = x; gs.current.input.startY = y; gs.current.input.isDragging = false;
      } else if (e.type === 'mousemove' || e.type === 'touchmove') {
          if(Math.hypot(x-gs.current.input.startX, y-gs.current.input.startY) > 5) {
              gs.current.input.isDragging = true;
              gs.current.camera.targetX += (gs.current.input.startX - x);
              gs.current.camera.targetY += (gs.current.input.startY - y);
              gs.current.input.startX = x; gs.current.input.startY = y;
          }
      } else if (e.type === 'mouseup' || e.type === 'touchend') {
          if(!gs.current.input.isDragging && buildMode) {
              const cam = gs.current.camera;
              const adjX = x - window.innerWidth/2 + cam.x;
              const adjY = y - window.innerHeight/2 + cam.y;
              const isoY = (2 * adjY - adjX) / 2; 
              const isoX = adjX + isoY;
              const tileX = Math.round(isoX / 64);
              const tileY = Math.round(isoY / 64);
              placeBuilding(tileX, tileY);
          }
      }
  };

  const handleZoom = (d: number) => {
      let z = gs.current.camera.zoom + d;
      gs.current.camera.zoom = Math.max(CONFIG.ZOOM_MIN, Math.min(CONFIG.ZOOM_MAX, z));
  };

  return (
    <div className="fixed inset-0 bg-slate-900 overflow-hidden select-none font-sans text-white">
        
        {loginModal && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur">
                <div className="bg-slate-800 p-6 rounded-2xl w-80 text-center border border-emerald-500/50 shadow-2xl">
                    <h1 className="text-3xl font-bold text-emerald-400 mb-6 tracking-widest">TREE KINGDOM</h1>
                    <input className="w-full bg-slate-900 p-3 rounded mb-3 border border-slate-600 text-center" placeholder="Kullanıcı Adı" value={usernameInput} onChange={e=>setUsernameInput(e.target.value)} />
                    <input className="w-full bg-slate-900 p-3 rounded mb-3 border border-slate-600 text-center" placeholder="PIN (4 Hane)" maxLength={4} value={pinInput} onChange={e=>setPinInput(e.target.value)} />
                    {loginError && <p className="text-red-400 text-sm mb-3">{loginError}</p>}
                    <button onClick={handleLogin} className="w-full bg-emerald-600 hover:bg-emerald-500 py-3 rounded font-bold transition">OYUNA GİR</button>
                </div>
            </div>
        )}

        {techModal && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                <div className="bg-slate-900 rounded-2xl border border-white/20 w-full max-w-lg p-6">
                    <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
                        <h2 className="text-2xl font-bold text-purple-400">🧪 Teknoloji</h2>
                        <button onClick={()=>setTechModal(false)} className="text-red-400 font-bold">KAPAT</button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        {(['tool', 'nature', 'speed', 'cap', 'war', 'wall'] as const).map(key => {
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

        <div className="absolute top-0 left-0 right-0 z-20 p-2 flex justify-center pointer-events-none">
            <div className="bg-black/80 backdrop-blur rounded-2xl p-2 flex items-center gap-4 border border-white/10 pointer-events-auto shadow-lg">
                <div className="flex gap-3 text-sm font-bold font-mono">
                    <span className="text-emerald-400">🌲 {Math.floor(ui.res.wood)}</span>
                    <span className="text-stone-400">🪨 {Math.floor(ui.res.stone)}</span>
                    <span className="text-yellow-400">💰 {Math.floor(ui.res.gold)}</span>
                    <span className="text-orange-400">🍗 {Math.floor(ui.res.food)}</span>
                </div>
                <div className="w-px h-6 bg-white/20"></div>
                <div className="flex flex-col items-center leading-none">
                    <span className="text-xs text-gray-400">NÜFUS</span>
                    <span className="font-bold">{ui.pop}/{ui.maxPop}</span>
                </div>
                <div className="w-px h-6 bg-white/20"></div>
                <div className="flex flex-col items-center leading-none w-20">
                    <span className="text-xs text-blue-400">LEVEL {ui.level}</span>
                    <div className="w-full h-1.5 bg-gray-700 rounded-full mt-1 overflow-hidden">
                        <div className="h-full bg-blue-500" style={{width: `${(ui.xp/ui.xpNext)*100}%`}}></div>
                    </div>
                </div>
                <div className={`px-2 py-1 rounded text-xs font-bold ${ui.isNight ? 'bg-red-900 text-red-200' : 'bg-sky-900 text-sky-200'}`}>
                    {ui.timer}
                </div>
            </div>
        </div>

        <div className="absolute top-20 w-full text-center z-10 pointer-events-none">
            <span className="bg-black/60 px-4 py-1 rounded text-yellow-300 text-sm font-bold shadow">{infoText}</span>
        </div>

        <div className="absolute top-24 right-4 z-20 flex flex-col gap-2 w-48">
            {showQuestBox && (
                <div className="bg-slate-900/90 border border-amber-600/50 p-3 rounded-lg shadow-xl relative animate-in slide-in-from-right">
                    <button onClick={()=>setShowQuestBox(false)} className="absolute top-1 right-2 text-xs text-gray-500">✕</button>
                    <h3 className="text-amber-500 text-xs font-bold mb-1">📜 GÜNLÜK GÖREV</h3>
                    <p className="text-xs text-gray-300">{ui.quest.desc}</p>
                    <div className="w-full h-1.5 bg-gray-700 rounded mt-1"><div className="h-full bg-amber-500" style={{width: `${(ui.quest.current/ui.quest.target)*100}%`}}></div></div>
                </div>
            )}
            {!showQuestBox && <button onClick={()=>setShowQuestBox(true)} className="bg-slate-800 p-2 rounded-full border border-amber-600 text-xl self-end">📜</button>}
            
            {ui.trader && <div className="bg-purple-900/90 border border-purple-500 p-2 rounded-lg text-center animate-bounce cursor-pointer" onClick={()=>setActiveMenu('market')}>🎒 TÜCCAR</div>}
        </div>

        <div className="absolute bottom-24 left-4 z-20 w-64">
            <div className={`bg-black/70 backdrop-blur rounded-lg border border-white/10 overflow-hidden transition-all ${showChat ? 'h-48' : 'h-8'}`}>
                <div className="bg-black/50 p-1 flex justify-between items-center cursor-pointer" onClick={()=>setShowChat(!showChat)}>
                    <span className="text-xs font-bold text-gray-400 pl-2">💬 GLOBAL CHAT</span>
                    <span className="text-xs pr-2">{showChat ? '▼' : '▲'}</span>
                </div>
                {showChat && (
                    <div className="flex flex-col h-40">
                        <div className="flex-1 overflow-y-auto p-2 space-y-1 text-xs">
                            {chatMessages.map((m, i) => (
                                <div key={i}><span className="text-emerald-400 font-bold">{m.user}:</span> <span className="text-gray-200">{m.text}</span></div>
                            ))}
                        </div>
                        <div className="p-1 flex gap-1 border-t border-white/10">
                            <input className="flex-1 bg-transparent text-xs p-1 outline-none text-white" placeholder="Mesaj yaz..." value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendChat()} />
                            <button onClick={sendChat} className="bg-emerald-700 px-2 rounded text-xs">&gt;</button>
                        </div>
                    </div>
                )}
            </div>
        </div>

        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
            <div className="flex gap-2 bg-slate-900/90 p-2 rounded-2xl border border-white/10 shadow-2xl backdrop-blur-md">
                <MenuBtn icon="🔨" label="YAPI" active={activeMenu==='build'} onClick={()=>setActiveMenu(activeMenu==='build'?'none':'build')} />
                <MenuBtn icon="⚡" label="BÜYÜ" active={activeMenu==='magic'} onClick={()=>setActiveMenu(activeMenu==='magic'?'none':'magic')} />
                <MenuBtn icon="⚖️" label="PAZAR" active={activeMenu==='market'} onClick={()=>setActiveMenu(activeMenu==='market'?'none':'market')} />
                <div className="w-px bg-white/20 mx-1"></div>
                <MenuBtn icon="👷" label="İŞÇİ" onClick={()=>spawnUnit('worker')} />
                <MenuBtn icon="⚔️" label="ASKER" onClick={()=>spawnUnit('soldier')} />
                <MenuBtn icon={hasKing ? "👑" : "🤴"} label={hasKing ? `Lvl ${ui.heroLvl}` : "KRAL"} onClick={()=>spawnUnit(hasKing ? 'upgrade_king' : 'king')} />
                <div className="w-px bg-white/20 mx-1"></div>
                <MenuBtn icon="🧪" label="TEKNO" onClick={()=>{setTechModal(true); setInfoText("Geliştirmeler");}} />
            </div>

            {activeMenu === 'build' && (
                <div className="absolute bottom-20 left-0 w-full flex justify-center">
                    <div className="bg-slate-800 p-3 rounded-xl border border-orange-500 flex gap-2 overflow-x-auto max-w-sm">
                        {Object.entries(CONFIG.BUILDINGS).map(([key, b]) => (
                            <button key={key} onClick={()=>handleBuild(key)} className="flex flex-col items-center bg-slate-700 p-2 rounded min-w-[60px] hover:bg-slate-600">
                                <span className="text-2xl">{b.icon}</span>
                                <span className="text-[10px] font-bold mt-1">{b.name}</span>
                                <span className="text-[9px] text-yellow-400">{b.cost} Odun</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {activeMenu === 'magic' && (
                <div className="absolute bottom-20 left-0 w-full flex justify-center">
                    <div className="bg-slate-800 p-3 rounded-xl border border-blue-500 flex gap-2 overflow-x-auto max-w-sm">
                        {CONFIG.SPELLS.map(s => (
                            <button key={s.id} onClick={()=>castSpell(s.id)} className="flex flex-col items-center bg-slate-700 p-2 rounded min-w-[60px] hover:bg-slate-600">
                                <span className="text-2xl">{s.icon}</span>
                                <span className="text-[10px] font-bold mt-1">{s.name}</span>
                                <span className="text-[9px] text-blue-300">{s.mana} Mana</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {activeMenu === 'market' && (
                <div className="absolute bottom-20 left-0 w-full flex justify-center">
                    <div className="bg-slate-800 p-3 rounded-xl border border-yellow-500 flex flex-col gap-2 w-64">
                        <h3 className="text-center font-bold text-yellow-400 border-b border-white/10 pb-1">PAZAR YERİ</h3>
                        {CONFIG.TRADES.map(t => (
                            <button key={t.id} onClick={()=>executeTrade(t.id)} className="flex justify-between items-center bg-slate-700 p-2 rounded hover:bg-slate-600 text-xs">
                                <span>{t.desc}</span>
                                <span className="text-gray-400">{t.give.amount} &rarr; {t.get.amount}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>

        <div className="absolute top-24 left-4 flex flex-col gap-2 pointer-events-auto z-20"> 
            <button onClick={()=>handleZoom(0.1)} className="bg-slate-700 w-10 h-10 rounded text-xl font-bold border border-white/10">+</button> 
            <button onClick={()=>handleZoom(-0.1)} className="bg-slate-700 w-10 h-10 rounded text-xl font-bold border border-white/10">-</button> 
        </div>

        {ui.trader && <div onClick={()=>{setTraderModal(true)}} className="absolute top-40 right-4 w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center border-2 border-white animate-bounce cursor-pointer z-30">🎒</div>}
      
        {traderModal && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <div className="bg-purple-900 rounded-2xl border border-purple-500 w-72 p-6 shadow-2xl">
                  <h2 className="text-xl font-bold text-white mb-4">GEZGİN TÜCCAR 🎒</h2>
                  {CONFIG.TRADER_DEALS.map(t => (
                      <button key={t.id} onClick={()=>executeTrade(t.id)} className="w-full bg-purple-800 p-3 rounded mb-2 border border-purple-600 hover:bg-purple-700 text-left">
                          <div className="font-bold text-white">{t.desc}</div>
                          <div className="text-xs text-purple-200">Ver: {t.give.amount} {t.give.type} &rarr; Al: {t.get.amount} {t.get.type}</div>
                      </button>
                  ))}
                  <button onClick={()=>setTraderModal(false)} className="w-full mt-4 bg-red-600 py-2 rounded text-white font-bold">KAPAT</button>
              </div>
          </div>
        )}

        <canvas ref={canvasRef} className="block w-full h-full cursor-grab active:cursor-grabbing touch-none z-0" onMouseDown={handleInput} onMouseMove={handleInput} onMouseUp={handleInput} onTouchStart={handleInput} onTouchMove={handleInput} onTouchEnd={handleInput} onWheel={(e)=>handleZoom(e.deltaY>0?-0.1:0.1)} />
    </div>
  );
}

const MenuBtn = ({icon, label, active, onClick}: any) => (
    <button onClick={onClick} className={`flex flex-col items-center justify-center w-12 h-12 rounded-xl transition-all ${active ? 'bg-emerald-600 text-white shadow-lg scale-110' : 'bg-slate-800 text-gray-400 hover:bg-slate-700'}`}>
        <span className="text-xl">{icon}</span>
        <span className="text-[8px] font-bold mt-0.5">{label}</span>
    </button>
);
