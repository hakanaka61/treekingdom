"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, update, onValue, query, orderByChild, limitToLast, get, equalTo } from "firebase/database";

// ==========================================
// 1. AYARLAR & OYUN DENGESİ
// ==========================================
const CONFIG = {
  TILE_WIDTH: 128, TILE_HEIGHT: 64,
  MAP_SIZE: 40,
  ZOOM_MIN: 0.2, ZOOM_MAX: 1.5,
  OVERLAP_STRENGTH: 1.20,
  
  // DÖNGÜLER
  BASE_SPAWN_TIME: 30000, // 30 Saniye (Temel Hız)
  BASE_WORK_TIME: 10000,  // 10 Saniye (Toplama Süresi)
  MIN_WORK_TIME: 2000,    // 2 Saniye (En hızlı)
  DAY_CYCLE_DURATION: 60000,

  // ORANLAR (Toplam 1.0 olmalı)
  SPAWN_RATES: {
      tree: 0.50,  // %50 Ağaç (Yaygın)
      stone: 0.20, // %20 Taş (Normal)
      deer: 0.20,  // %20 Geyik (Yemek Kaynağı)
      gold: 0.10   // %10 Altın (Çok Nadir - Değerli)
  },

  RANKS: [
      { min: 0, title: "Sürgün", icon: "🍂", color: "#71717a" },
      { min: 1000, title: "Köylü", icon: "🥉", color: "#a1a1aa" },
      { min: 5000, title: "Şövalye", icon: "🥈", color: "#60a5fa" },
      { min: 15000, title: "Lord", icon: "🥇", color: "#facc15" },
      { min: 50000, title: "İMPARATOR", icon: "👑", color: "#ef4444" }
  ],

  // TEKNOLOJİ (Altın geliştirmeleri daha pahalı ve zor)
  UPGRADES: {
      tool: { 
          name: "Elmas Uçlar", icon: "⚒️", 
          desc: "Toplama hızını artırır.", baseCost: 150, mult: 1.6, // Maliyet artışı yükseltildi
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
    deer: '/assets/deer.png', // GEYİK EKLENDİ
    house: '/assets/house.png',
    castle: '/assets/castle.png',
    worker: '/assets/worker.png',
  }
};

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
        stats: { score: 0 }, 
        upgrades: { tool: 0, nature: 0, speed: 0, cap: 0 },
        maxPop: 5 
    },
    camera: { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 0.5 },
    input: { isDragging: false, lastX: 0, lastY: 0 },
    userId: null as string | null,
    isLoaded: false,
    lastTime: Date.now(),
    nextSpawnTime: Date.now() + CONFIG.BASE_SPAWN_TIME,
    timeOfDay: 0
  });

  const [ui, setUi] = useState({ res: gs.current.player.resources, pop: 0, maxPop: 5, nextSpawn: 30 });
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loginModal, setLoginModal] = useState(false);
  const [techModal, setTechModal] = useState(false);
  
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

    // Kamera
    const centerX = 0; 
    const centerY = (CONFIG.MAP_SIZE) * (CONFIG.TILE_HEIGHT/2);
    gs.current.camera.x = centerX; gs.current.camera.y = centerY;
    gs.current.camera.targetX = centerX; gs.current.camera.targetY = centerY;

    // Otomatik Giriş
    const savedUid = localStorage.getItem("orman_v16_uid");
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
        setUi(prev => ({...prev, nextSpawn: timeLeft}));
    }, 1000);

    const saveTimer = setInterval(saveGame, 5000);
    return () => { cancelAnimationFrame(anim); clearInterval(saveTimer); clearInterval(uiTimer); };
  }, []);

  const connectToDb = (uid: string) => {
      onValue(ref(db, `empires_final/${uid}`), (snap) => {
          const val = snap.val();
          if(val) {
              gs.current.player = val.player;
              if(!gs.current.player.upgrades) gs.current.player.upgrades = { tool:0, nature:0, speed:0, cap:0 };
              if(!gs.current.player.resources) gs.current.player.resources = { wood: 50, stone: 0, gold: 0, food: 60 };
              gs.current.entities = val.entities || [];
              updateUi();
          } else {
              initWorld(uid);
          }
      });
  };

  const initWorld = (uid: string) => {
      const cx = Math.floor(CONFIG.MAP_SIZE/2);
      gs.current.entities = [{ id: 'castle', type: 'castle', pos: {x:cx, y:cx}, pixelPos: {x:0,y:0}, hp:5000, maxHp:5000, owner:uid }];
      for(let i=0; i<30; i++) spawnRandomResource(true);
      saveGame();
  };

  const handleLogin = async () => {
      if(!usernameInput.trim() || pinInput.length !== 4) {
          setLoginError("İsim girin ve 4 haneli şifre belirleyin.");
          return;
      }
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
                  localStorage.setItem("orman_v16_uid", foundUid!);
                  gs.current.userId = foundUid;
                  setLoginModal(false);
                  connectToDb(foundUid!);
                  log(`Hoşgeldin İmparator ${cleanName}!`);
              } else {
                  setLoginError("❌ Hatalı Şifre!");
              }
          } else {
              const newUid = "u_" + Date.now() + Math.random().toString(36).substr(2,5);
              gs.current.player.username = cleanName;
              gs.current.player.pin = pinInput;
              gs.current.userId = newUid;
              localStorage.setItem("orman_v16_uid", newUid);
              setLoginModal(false);
              initWorld(newUid);
              log(`Yeni Krallık Kuruldu: ${cleanName}`);
          }
      } catch (error) {
          setLoginError("Bağlantı hatası.");
      }
  };

  // --- GELİŞMİŞ SPAWN SİSTEMİ (NADİRLİK AYARI) ---
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
                   
                   // İHTİMAL HESABI (Cumulative Probability)
                   if (r > (1 - CONFIG.SPAWN_RATES.gold)) type = 'gold'; // En nadir
                   else if (r > (1 - CONFIG.SPAWN_RATES.gold - CONFIG.SPAWN_RATES.deer)) type = 'deer';
                   else if (r > (1 - CONFIG.SPAWN_RATES.gold - CONFIG.SPAWN_RATES.deer - CONFIG.SPAWN_RATES.stone)) type = 'stone';
                   else type = 'tree';
                   
                   gs.current.entities.push({ id: `n_${Date.now()}_${attempt}`, type, pos: {x:rx, y:ry}, pixelPos: {x:0,y:0}, hp:100, maxHp:100, owner:'nature' });
                   found = true;
              }
          }
          attempt++;
      }
  };

  const updateUi = () => {
      setUi(prev => ({
          ...prev,
          res: {...gs.current.player.resources},
          pop: gs.current.entities.filter(e => e.type === 'worker' && e.owner === gs.current.userId).length,
          maxPop: gs.current.player.maxPop
      }));
      setUpgradesUI({...gs.current.player.upgrades});
  };

  const spawnFloatingText = (x: number, y: number, text: string, color: string) => {
      gs.current.particles.push({ x, y, text, color, life: 60, maxLife: 60, velocityY: 1.5 });
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

  const saveGame = () => {
      if(!gs.current.userId) return;
      const p = gs.current.player;
      let score = 0;

      // PUANLAMA (Altın çok değerli)
      score += (p.resources.gold || 0) * 10;
      score += (p.resources.stone || 0) * 3;
      score += (p.resources.wood || 0) * 1;
      score += (p.resources.food || 0) * 1;

      gs.current.entities.forEach(e => {
          if (e.owner === gs.current.userId) {
              if (e.type === 'castle') score += 100; 
              if (e.type === 'house') score += 50;
              if (e.type === 'worker') score += 10 + ((e.level||1) * 10);
          }
      });

      const techScore = (p.upgrades.tool + p.upgrades.nature + p.upgrades.speed + p.upgrades.cap) * 150;
      score += techScore;

      gs.current.player.stats.score = Math.floor(score);
      const updates: any = {};
      updates[`empires_final/${gs.current.userId}`] = { player: gs.current.player, entities: gs.current.entities };
      updates[`leaderboard/${gs.current.userId}`] = { username: gs.current.player.username, score: Math.floor(score) };
      update(ref(db), updates);
  };

  const updateLogic = () => {
      const now = Date.now();
      gs.current.camera.x += (gs.current.camera.targetX - gs.current.camera.x) * 0.1;
      gs.current.camera.y += (gs.current.camera.targetY - gs.current.camera.y) * 0.1;

      if(now >= gs.current.nextSpawnTime) {
          spawnRandomResource();
          const natureLvl = gs.current.player.upgrades.nature || 0;
          gs.current.nextSpawnTime = now + (CONFIG.BASE_SPAWN_TIME * Math.pow(0.9, natureLvl));
      }

      const cycle = (now % CONFIG.DAY_CYCLE_DURATION) / CONFIG.DAY_CYCLE_DURATION;
      gs.current.timeOfDay = Math.max(0, Math.sin(cycle * Math.PI * 2) * 0.6);

      gs.current.particles.forEach(p => { p.y -= p.velocityY; p.life--; });
      gs.current.particles = gs.current.particles.filter(p => p.life > 0);

      gs.current.entities.forEach(ent => {
          const tx = (ent.pos.x - ent.pos.y) * (CONFIG.TILE_WIDTH / 2);
          const ty = (ent.pos.x + ent.pos.y) * (CONFIG.TILE_HEIGHT / 2);
          if(!ent.pixelPos) ent.pixelPos = {x: tx, y: ty};
          ent.pixelPos.x += (tx - ent.pixelPos.x) * 0.1;
          ent.pixelPos.y += (ty - ent.pixelPos.y) * 0.1;

          if(ent.type === 'worker' && ent.owner === gs.current.userId) {
              if(!ent.level) ent.level = 1;

              if(ent.state === 'IDLE' && !ent.targetId) {
                  let closest=null, min=999;
                  gs.current.entities.forEach(e => {
                      if((e.type==='tree'||e.type==='stone'||e.type==='gold'||e.type==='deer') && e.hp>0) {
                          const d = Math.hypot(e.pos.x-ent.pos.x, e.pos.y-ent.pos.y);
                          if(d<min) { min=d; closest=e; }
                      }
                  });
                  if(closest && min<30) { ent.targetId = (closest as any).id; ent.state = 'MOVE'; }
              }
              else if(ent.state === 'MOVE' && ent.targetId) {
                  const t = gs.current.entities.find(e => e.id === ent.targetId);
                  if(t) {
                      const dx = t.pos.x - ent.pos.x;
                      const dy = t.pos.y - ent.pos.y;
                      const dist = Math.hypot(dx, dy);
                      if(dist < 1.1) {
                          ent.state = 'WORK';
                          ent.workStartTime = Date.now();
                      } else {
                          const speedLvl = gs.current.player.upgrades.speed || 0;
                          const speed = 0.05 + (ent.level * 0.005) + (speedLvl * 0.01);
                          ent.pos.x += (dx/dist)*speed;
                          ent.pos.y += (dy/dist)*speed;
                      }
                  } else { ent.state='IDLE'; ent.targetId=null; }
              }
              else if(ent.state === 'WORK' && ent.targetId) {
                  const t = gs.current.entities.find(e => e.id === ent.targetId);
                  if(t && t.hp > 0) {
                      const toolLvl = gs.current.player.upgrades.tool || 0;
                      // ALTIN DAHA ZOR KAZILIR (Süreye +2 saniye ekler)
                      let difficulty = t.type === 'gold' ? 2000 : 0;
                      const requiredTime = Math.max(CONFIG.MIN_WORK_TIME, CONFIG.BASE_WORK_TIME + difficulty - (toolLvl * 800));
                      
                      if(Date.now() - ent.workStartTime >= requiredTime) {
                          let val = 20 + (ent.level * 2);
                          let color = 'white';
                          
                          if(t.type==='tree') { 
                              gs.current.player.resources.wood += val; 
                              color='#a3e635'; 
                              spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 50, `+${val} Odun`, color);
                          }
                          if(t.type==='stone') {
                              gs.current.player.resources.stone += val;
                              color='#94a3b8';
                              spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 50, `+${val} Taş`, color);
                          }
                          if(t.type==='gold') {
                              gs.current.player.resources.gold += val;
                              color='#facc15';
                              spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 50, `+${val} Altın`, color);
                          }
                          if(t.type==='deer') {
                              gs.current.player.resources.food += val;
                              color='#fb923c';
                              spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 50, `+${val} Et`, color);
                          }
                          
                          ent.xp = (ent.xp||0) + 10;
                          if(ent.xp > ent.level*100) {
                              ent.level++;
                              spawnFloatingText(ent.pixelPos.x, ent.pixelPos.y - 80, "LEVEL UP!", "#ef4444");
                          }

                          gs.current.entities = gs.current.entities.filter(e => e.id !== t.id);
                          ent.state='IDLE'; ent.targetId=null;
                          updateUi(); saveGame();
                      }
                  } else { ent.state='IDLE'; ent.targetId=null; }
              }
          }
      });
  };

  const getRank = (score: number) => {
      for(let i = CONFIG.RANKS.length-1; i >= 0; i--) {
          if(score >= CONFIG.RANKS[i].min) return CONFIG.RANKS[i];
      }
      return CONFIG.RANKS[0];
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
            ctx.drawImage(img, pos.x-w/2, drawY, w, h);

            if(ent.type === 'worker') {
                ctx.fillStyle='white'; ctx.font=`bold ${10*zoom}px Arial`; ctx.fillText(`Lvl ${ent.level||1}`, pos.x - 10, drawY);
                if(ent.state === 'WORK') {
                    const toolLvl = gs.current.player.upgrades.tool || 0;
                    const maxTime = Math.max(CONFIG.MIN_WORK_TIME, CONFIG.BASE_WORK_TIME - (toolLvl * 800));
                    const pct = Math.min(1, (Date.now() - ent.workStartTime) / maxTime);
                    const barW = 40 * zoom;
                    ctx.fillStyle = '#333'; ctx.fillRect(pos.x - barW/2, drawY - 15, barW, 4);
                    ctx.fillStyle = '#fbbf24'; ctx.fillRect(pos.x - barW/2, drawY - 15, barW * pct, 4);
                }
            }
        }
    });

    gs.current.particles.forEach(p => {
        const screenX = (p.x * zoom) + cvs.width/2 - cam.x; 
        const screenY = (p.y * zoom) + cvs.height/2 - cam.y;
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.font = `bold ${16 * zoom}px Arial`;
        ctx.strokeStyle = 'black'; ctx.lineWidth = 2;
        ctx.strokeText(p.text, screenX, screenY);
        ctx.fillText(p.text, screenX, screenY);
        ctx.globalAlpha = 1.0;
    });

    if(gs.current.timeOfDay > 0.05) {
        ctx.fillStyle = `rgba(0, 0, 50, ${gs.current.timeOfDay})`; 
        ctx.fillRect(0,0,cvs.width, cvs.height);
    }
  };

  const handleInput = (e: any) => {
    const cx = e.clientX || e.touches?.[0]?.clientX;
    const cy = e.clientY || e.touches?.[0]?.clientY;
    if(e.type==='mousedown' || e.type==='touchstart') {
        gs.current.input.isDragging=true; gs.current.input.lastX=cx; gs.current.input.lastY=cy;
        if(buildMode && e.type!=='touchstart') handleBuild(e);
    } 
    else if(e.type==='mousemove' || e.type==='touchmove') {
        if(gs.current.input.isDragging) {
            gs.current.camera.targetX += (gs.current.input.lastX - cx);
            gs.current.camera.targetY += (gs.current.input.lastY - cy);
            gs.current.input.lastX=cx; gs.current.input.lastY=cy;
        }
    } 
    else if(e.type==='mouseup' || e.type==='touchend') {
        gs.current.input.isDragging=false;
        if(buildMode && e.type==='touchend') handleBuild(e);
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

  const spawnUnit = () => {
      if(ui.pop >= ui.maxPop) { log("Nüfus Dolu!"); return; }
      if(gs.current.player.resources.food >= 60) {
          gs.current.player.resources.food -= 60;
          const cx = Math.floor(CONFIG.MAP_SIZE/2);
          gs.current.entities.push({ id: `u_${Date.now()}`, type: 'worker', pos: {x:cx, y:cx}, pixelPos:null, hp:100, maxHp:100, state:'IDLE', owner:gs.current.userId });
          updateUi(); saveGame(); 
          spawnFloatingText(0, (CONFIG.MAP_SIZE*CONFIG.TILE_HEIGHT)/2, "-60 Et", 'red');
      } else { log("Yetersiz Yemek (60 gerekli)"); }
  };

  const handleZoom = (d: number) => {
      let z = gs.current.camera.zoom + d;
      gs.current.camera.zoom = Math.max(CONFIG.ZOOM_MIN, Math.min(CONFIG.ZOOM_MAX, z));
  };

  return (
    <div className="fixed inset-0 bg-gray-900 text-white select-none overflow-hidden touch-none font-sans">
      
      {loginModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur">
            <div className="bg-slate-800 p-8 rounded-2xl w-80 text-center border border-white/10 shadow-2xl">
                <h2 className="text-3xl font-bold mb-4 text-blue-400 font-mono tracking-widest">ORMAN ONLİNE</h2>
                <input type="text" placeholder="İmparator Adı" className="w-full bg-slate-900 p-3 rounded mb-2 border border-gray-600 outline-none text-white text-center"
                   value={usernameInput} onChange={e=>setUsernameInput(e.target.value)} maxLength={12} />
                <input type="password" placeholder="PIN (4 Hane)" className="w-full bg-slate-900 p-3 rounded mb-4 border border-gray-600 outline-none text-white tracking-[0.5em] text-center font-bold"
                   value={pinInput} onChange={e=>setPinInput(e.target.value)} maxLength={4} inputMode="numeric" />
                
                {loginError && <div className="text-red-400 text-xs mb-3 bg-red-900/20 p-2 rounded">{loginError}</div>}
                <button onClick={handleLogin} className="w-full bg-blue-600 py-3 rounded font-bold hover:bg-blue-500 shadow-lg transition active:scale-95 border border-blue-400/50">GİRİŞ YAP / KAYIT OL ⚔️</button>
            </div>
        </div>
      )}

      {techModal && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 rounded-2xl border border-white/20 w-full max-w-lg p-6 shadow-2xl">
                <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
                    <h2 className="text-2xl font-bold text-purple-400">🧪 Teknoloji</h2>
                    <button onClick={()=>setTechModal(false)} className="text-red-400 font-bold hover:bg-red-900/20 px-3 py-1 rounded">KAPAT</button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    {(['tool', 'nature', 'speed', 'cap'] as const).map(key => {
                        const conf = CONFIG.UPGRADES[key];
                        const lvl = upgradesUI[key] || 0;
                        const cost = Math.floor(conf.baseCost * Math.pow(conf.mult, lvl));
                        return (
                            <div key={key} className="bg-slate-800 p-4 rounded-xl border border-white/5 group relative hover:border-purple-500/50 transition">
                                <div className="absolute top-2 right-2 text-xs text-gray-500 font-mono bg-black/50 px-2 rounded">Lvl {lvl}</div>
                                <div className="text-3xl mb-1">{conf.icon}</div>
                                <div className="font-bold text-gray-200">{conf.name}</div>
                                <div className="text-[10px] text-gray-400 h-8 leading-tight">{conf.desc}</div>
                                <div className="text-xs text-green-400 font-mono mb-2">{conf.effectDesc(lvl)}</div>
                                <button onClick={()=>buyUpgrade(key)} className="w-full bg-slate-700 hover:bg-purple-600 py-2 rounded text-xs border border-white/10 transition active:scale-95">
                                    {lvl>=10 ? "MAX" : `${cost} Odun`}
                                </button>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
      )}

      {/* YENİ KAYNAK BARI (ÜST ORTA) - HUD TASARIMI */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex gap-2 pointer-events-none">
          <div className="flex gap-4 bg-black/60 backdrop-blur-md px-6 py-2 rounded-full border border-white/10 shadow-2xl">
              <ResItem i="🌲" v={ui.res.wood} t="Odun" c="text-emerald-400" />
              <div className="w-px bg-white/10"></div>
              <ResItem i="🪨" v={ui.res.stone} t="Taş" c="text-stone-300" />
              <div className="w-px bg-white/10"></div>
              <ResItem i="💰" v={ui.res.gold} t="Altın" c="text-yellow-400" />
              <div className="w-px bg-white/10"></div>
              <ResItem i="🍗" v={ui.res.food} t="Et" c="text-orange-400" />
              <div className="w-px bg-white/10"></div>
              <div className="flex flex-col items-center justify-center">
                   <div className="flex items-center gap-1">
                       <span className="text-lg">👥</span>
                       <span className="font-mono font-bold text-white">{ui.pop}<span className="text-gray-500">/</span>{ui.maxPop}</span>
                   </div>
              </div>
          </div>
      </div>

      {/* LİDER TABLOSU (SAĞ ÜST) - SIKIŞTIRILMIŞ */}
      <div className="absolute top-4 right-4 bg-black/60 p-3 rounded-xl border border-yellow-500/30 w-48 pointer-events-none z-20 backdrop-blur-sm">
          <h3 className="text-yellow-400 font-bold text-[10px] border-b border-white/10 pb-1 mb-1 tracking-widest text-center">🏆 LİDERLER</h3>
          {leaderboard.map((p,i) => {
              const rank = getRank(p.score);
              return (
                <div key={i} className="flex justify-between text-[10px] mb-1 items-center">
                    <div className="flex items-center gap-1 overflow-hidden">
                        <span className="text-gray-500 w-3">{i+1}.</span>
                        <span title={rank.title}>{rank.icon}</span>
                        <span className={`${p.username===gs.current.player.username ? 'text-green-400 font-bold' : 'text-gray-300'} truncate w-20`}>{p.username.split('#')[0]}</span>
                    </div>
                    <span className="text-yellow-600 font-mono">{p.score}</span>
                </div>
              )
          })}
      </div>

      {/* ALT MENÜ VE SAYAÇLAR (YENİ KONUM) */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-auto z-20">
          
          {/* SAYAÇLAR (MENÜNÜN ÜSTÜNDE) */}
          <div className="flex gap-4 text-xs font-mono font-bold bg-black/40 px-3 py-1 rounded-full border border-white/5 backdrop-blur-sm mb-1">
              <span className="text-green-400">Yeni Kaynak: {ui.nextSpawn}s</span>
          </div>

          <div className="bg-black/80 p-3 rounded-2xl border border-white/10 flex gap-2 backdrop-blur-sm shadow-xl relative">
            <Btn i="👷" l="İşçi" sub="60 Et" onClick={spawnUnit} desc="Kaynak toplar" />
            <div className="w-px bg-white/20"></div>
            <Btn i="🏠" l="Ev" sub="100 Odun" onClick={()=>setBuildMode('house')} act={buildMode==='house'} desc="Görsel (50 P)" />
            <Btn i="🏰" l="Kale" sub="500 Odun" onClick={()=>setBuildMode('castle')} act={buildMode==='castle'} desc="Merkez (100 P)" />
            <div className="w-px bg-white/20"></div>
            <Btn i="🧪" l="Tekno" sub="Yükselt" onClick={()=>setTechModal(true)} act={techModal} desc="Gelişim" />
          </div>
      </div>

      <div className="absolute top-24 left-4 flex flex-col gap-2 pointer-events-auto z-20">
          <button onClick={()=>handleZoom(0.1)} className="bg-slate-700 w-10 h-10 rounded shadow hover:bg-slate-600 text-xl font-bold border border-white/10 text-white">+</button>
          <button onClick={()=>handleZoom(-0.1)} className="bg-slate-700 w-10 h-10 rounded shadow hover:bg-slate-600 text-xl font-bold border border-white/10 text-white">-</button>
      </div>
      
      <div className="absolute bottom-4 left-4 pointer-events-none opacity-60 flex flex-col items-start gap-1 z-10">
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

const ResItem = ({i,v,t,c}:any) => (
    <div className="flex flex-col items-center min-w-[36px] group relative">
        <span className="text-xl drop-shadow-md">{i}</span>
        <span className={`font-mono font-bold text-xs ${c}`}>{Math.floor(v)}</span>
        <div className="absolute top-full mt-1 hidden group-hover:block bg-black text-[10px] text-white px-1 rounded">{t}</div>
    </div>
);

const Btn = ({i,l,sub,onClick,act,desc}:any) => (
    <button onClick={onClick} className={`group relative flex flex-col items-center justify-center w-14 h-14 rounded-xl border transition-all active:scale-95 duration-200 ${act?'bg-purple-700 border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.5)]':'bg-transparent border-transparent hover:bg-white/10'}`}>
        <span className="text-2xl group-hover:-translate-y-1 transition-transform duration-300">{i}</span>
        <span className="text-[9px] uppercase font-bold mt-0.5 text-gray-300">{l}</span>
        <span className="text-[8px] text-yellow-500 font-mono">{sub}</span>
        <div className="absolute bottom-full mb-3 hidden group-hover:block w-28 bg-black/90 text-white text-[10px] p-2 rounded border border-white/20 z-50 pointer-events-none shadow-lg text-center backdrop-blur-sm">
            {desc}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-black/90"></div>
        </div>
    </button>
);
