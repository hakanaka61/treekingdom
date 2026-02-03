"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getDatabase, ref, set, onValue, update, serverTimestamp } from "firebase/database";

// ==========================================
// 1. OYUN AYARLARI (GAME CONFIG)
// ==========================================
const CONFIG = {
  TILE_SIZE: 64,   // Grafik kalitesi
  MAP_SIZE: 40,    // Harita genişliği
  TICK_RATE: 60,   // FPS
  SAVE_INTERVAL: 5000, // Otomatik kayıt süresi (ms)
  COLORS: {
    water: '#4fc3f7',
    waterDeep: '#0288d1',
    grass: '#66bb6a',
    grassDark: '#388e3c',
    stone: '#78909c',
    highlight: 'rgba(255, 255, 255, 0.3)',
    highlightRed: 'rgba(255, 0, 0, 0.3)'
  }
};

// ==========================================
// 2. FIREBASE BAĞLANTISI (SENİN BİLGİLERİN)
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

// Singleton Pattern: Uygulama tekrar tekrar başlatılmasın diye kontrol ediyoruz
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getDatabase(app);

// Analytics sadece tarayıcıda çalışır, sunucuda hata vermesin diye kontrol ediyoruz
if (typeof window !== 'undefined') {
  isSupported().then((yes) => yes && getAnalytics(app));
}

// ==========================================
// 3. TİP TANIMLAMALARI (TYPESCRIPT)
// ==========================================
type Vector2 = { x: number, y: number };
type EntityType = 'tree' | 'rock' | 'worker' | 'soldier' | 'house' | 'barracks' | 'wall' | 'town_hall';

interface Entity {
  id: string;
  type: EntityType;
  pos: Vector2;       // Grid koordinatı (Örn: 10, 10)
  pixelPos: Vector2;  // Animasyon için ekran koordinatı
  state: string;      // IDLE, MOVE, WORK
  targetId?: string;  
  hp: number;
  maxHp: number;
  owner: string;
}

interface PlayerData {
  resources: { wood: number; stone: number; gold: number; food: number; };
  techs: string[];
  maxPop: number;
}

// ==========================================
// 4. SPRITE GENERATOR (KOD İLE GRAFİK ÇİZİMİ)
// ==========================================
const SpriteFactory = {
  cache: new Map<string, HTMLCanvasElement>(),

  get(type: string): HTMLCanvasElement {
    if (this.cache.has(type)) return this.cache.get(type)!;

    const cvs = document.createElement('canvas');
    cvs.width = CONFIG.TILE_SIZE;
    cvs.height = CONFIG.TILE_SIZE;
    const ctx = cvs.getContext('2d')!;
    const w = CONFIG.TILE_SIZE;

    // Ortak Gölge
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(w/2, w-10, w/3, w/6, 0, 0, Math.PI*2); ctx.fill();

    if (type === 'tree') {
      ctx.fillStyle = '#5d4037'; ctx.fillRect(w/2-6, w-30, 12, 20); // Gövde
      ctx.fillStyle = '#2e7d32'; ctx.beginPath(); ctx.moveTo(w/2-20, w-25); ctx.lineTo(w/2+20, w-25); ctx.lineTo(w/2, w-60); ctx.fill();
      ctx.fillStyle = '#4caf50'; ctx.beginPath(); ctx.moveTo(w/2-15, w-40); ctx.lineTo(w/2+15, w-40); ctx.lineTo(w/2, w-70); ctx.fill();
    } 
    else if (type === 'rock') {
      ctx.fillStyle = '#757575'; ctx.beginPath(); ctx.arc(w/2, w-20, 14, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#9e9e9e'; ctx.beginPath(); ctx.arc(w/2-4, w-24, 6, 0, Math.PI*2); ctx.fill();
    }
    else if (type === 'worker') {
      ctx.fillStyle = '#1565c0'; ctx.fillRect(w/2-6, w-32, 12, 18); // Vücut
      ctx.fillStyle = '#ffcc80'; ctx.beginPath(); ctx.arc(w/2, w-38, 8, 0, Math.PI*2); ctx.fill(); // Kafa
      ctx.fillStyle = '#fbc02d'; ctx.fillRect(w/2-8, w-46, 16, 4); // Baret
    }
    else if (type === 'house') {
      ctx.fillStyle = '#8d6e63'; ctx.fillRect(w/2-18, w-35, 36, 25);
      ctx.fillStyle = '#3e2723'; ctx.fillRect(w/2-5, w-20, 10, 10);
      ctx.fillStyle = '#c62828'; ctx.beginPath(); ctx.moveTo(w/2-22, w-35); ctx.lineTo(w/2+22, w-35); ctx.lineTo(w/2, w-55); ctx.fill();
    }
    else if (type === 'town_hall') {
      ctx.fillStyle = '#546e7a'; ctx.fillRect(w/2-22, w-45, 44, 35);
      ctx.fillStyle = '#263238'; ctx.beginPath(); ctx.moveTo(w/2-26, w-45); ctx.lineTo(w/2+26, w-45); ctx.lineTo(w/2, w-70); ctx.fill();
      ctx.fillStyle = '#fbc02d'; ctx.fillRect(w/2-2, w-70, 4, -10); // Bayrak direği
    }

    this.cache.set(type, cvs);
    return cvs;
  }
};

// ==========================================
// 5. ANA OYUN MOTORU (COMPONENT)
// ==========================================
export default function GamePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Game State (Ref ile performanslı yönetim)
  const gs = useRef({
    map: [] as number[][], 
    entities: [] as Entity[],
    player: {
      resources: { wood: 150, stone: 0, gold: 100, food: 50 },
      techs: [] as string[],
      maxPop: 5
    } as PlayerData,
    camera: { x: 0, y: 0, zoom: 1 },
    userId: null as string | null,
    lastUpdate: Date.now()
  });

  // UI State (Arayüz güncellemeleri için)
  const [uiRes, setUiRes] = useState(gs.current.player.resources);
  const [logs, setLogs] = useState<string[]>([]);
  const [buildMode, setBuildMode] = useState<EntityType | null>(null);
  const [isTechOpen, setIsTechOpen] = useState(false);

  // Log Yardımcısı
  const log = useCallback((msg: string) => {
    setLogs(prev => [`[Sistem] ${msg}`, ...prev].slice(0, 5));
  }, []);

  // --- INIT (BAŞLATMA) ---
  useEffect(() => {
    // 1. Kullanıcı ID Belirle
    let uid = localStorage.getItem("treekingdom_uid");
    if (!uid) { 
      uid = "lord_" + Math.random().toString(36).substr(2, 9); 
      localStorage.setItem("treekingdom_uid", uid); 
    }
    gs.current.userId = uid;

    // 2. Harita Oluştur (Prosedürel)
    const map = [];
    for(let x=0; x<CONFIG.MAP_SIZE; x++) {
      const row = [];
      for(let y=0; y<CONFIG.MAP_SIZE; y++) {
        const dist = Math.sqrt((x-CONFIG.MAP_SIZE/2)**2 + (y-CONFIG.MAP_SIZE/2)**2);
        if (dist > CONFIG.MAP_SIZE/2 - 2) row.push(2); // Derin Su
        else if (dist > CONFIG.MAP_SIZE/2 - 5) row.push(1); // Su
        else row.push(0); // Çim
      }
      map.push(row);
    }
    gs.current.map = map;

    // Kamera Merkezleme
    gs.current.camera.x = (CONFIG.MAP_SIZE * CONFIG.TILE_SIZE) / 2 - window.innerWidth / 2;
    gs.current.camera.y = (CONFIG.MAP_SIZE * CONFIG.TILE_SIZE) / 4 - window.innerHeight / 2;

    // 3. Firebase Veri Çekme
    const userRef = ref(db, `kingdoms/${uid}`);
    onValue(userRef, (snap) => {
      const val = snap.val();
      if (val) {
        gs.current.player = val.player;
        gs.current.entities = val.entities || [];
        setUiRes({...val.player.resources});
        log("Krallık verileri yüklendi.");
      } else {
        // Yeni Oyuncu İçin Dünya
        gs.current.entities = initWorld(uid!);
        saveGame();
        log("Yeni bir krallık kuruldu!");
      }
    });

    // 4. Döngüleri Başlat
    let animId: number;
    const loop = () => {
      updateLogic();
      render();
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);

    const saveTimer = setInterval(saveGame, CONFIG.SAVE_INTERVAL);

    return () => { cancelAnimationFrame(animId); clearInterval(saveTimer); };
  }, [log]);

  // --- DÜNYA BAŞLANGIÇ AYARLARI ---
  const initWorld = (uid: string) => {
    const ents: Entity[] = [];
    // Merkez Bina
    const cx = Math.floor(CONFIG.MAP_SIZE/2);
    ents.push({
      id: 'town_hall', type: 'town_hall',
      pos: {x: cx, y: cx}, pixelPos: {x: cx*CONFIG.TILE_SIZE, y: cx*CONFIG.TILE_SIZE},
      state: 'IDLE', hp: 2000, maxHp: 2000, owner: uid
    });

    // Rastgele Ağaçlar ve Taşlar
    for(let i=0; i<80; i++) {
      const rx = Math.floor(Math.random()*(CONFIG.MAP_SIZE-10))+5;
      const ry = Math.floor(Math.random()*(CONFIG.MAP_SIZE-10))+5;
      if(Math.abs(rx-cx)<4 && Math.abs(ry-cx)<4) continue; // Merkeze koyma
      
      ents.push({
        id: `env_${i}`,
        type: Math.random() > 0.3 ? 'tree' : 'rock',
        pos: {x: rx, y: ry}, pixelPos: {x: rx*CONFIG.TILE_SIZE, y: ry*CONFIG.TILE_SIZE},
        state: 'IDLE', hp: 100, maxHp: 100, owner: 'nature'
      });
    }
    return ents;
  };

  // --- OYUN MANTIĞI (UPDATE LOGIC) ---
  const updateLogic = () => {
    const now = Date.now();
    const dt = (now - gs.current.lastUpdate) / 1000;
    gs.current.lastUpdate = now;

    // AI Döngüsü
    gs.current.entities.forEach(ent => {
      // İŞÇİ YAPAY ZEKASI
      if (ent.type === 'worker' && ent.owner === gs.current.userId) {
        if (ent.state === 'IDLE') {
          // En yakın kaynağı bul
          let bestDist = 999;
          let target = null;
          gs.current.entities.forEach(e => {
            if ((e.type === 'tree' || e.type === 'rock') && e.hp > 0) {
              const d = Math.hypot(e.pos.x - ent.pos.x, e.pos.y - ent.pos.y);
              if (d < bestDist) { bestDist = d; target = e; }
            }
          });

          if (target && bestDist < 20) {
            ent.targetId = (target as Entity).id;
            ent.state = 'MOVE';
          }
        }
        else if (ent.state === 'MOVE') {
          const target = gs.current.entities.find(e => e.id === ent.targetId);
          if (target) {
            const dx = target.pos.x - ent.pos.x;
            const dy = target.pos.y - ent.pos.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist < 1) ent.state = 'WORK';
            else {
              const speed = 2 * dt;
              ent.pos.x += (dx/dist)*speed;
              ent.pos.y += (dy/dist)*speed;
              ent.pixelPos.x = ent.pos.x * CONFIG.TILE_SIZE;
              ent.pixelPos.y = ent.pos.y * CONFIG.TILE_SIZE;
            }
          } else {
            ent.state = 'IDLE';
          }
        }
        else if (ent.state === 'WORK') {
          const target = gs.current.entities.find(e => e.id === ent.targetId);
          if (target && target.hp > 0) {
            target.hp -= 2; // Kesme hızı
            if (target.hp <= 0) {
              // Kaynak Toplandı
              if (target.type === 'tree') { gs.current.player.resources.wood += 20; log("+20 Odun"); }
              if (target.type === 'rock') { gs.current.player.resources.stone += 10; log("+10 Taş"); }
              setUiRes({...gs.current.player.resources});
              
              // Entity Sil
              gs.current.entities = gs.current.entities.filter(e => e.id !== target.id);
              ent.state = 'IDLE';
            }
          } else {
            ent.state = 'IDLE';
          }
        }
      }
    });
  };

  // --- ÇİZİM MOTORU (RENDER) ---
  const render = () => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d', { alpha: false });
    if (!ctx) return;

    if (cvs.width !== window.innerWidth) { cvs.width = window.innerWidth; cvs.height = window.innerHeight; }

    const cam = gs.current.camera;
    const zoom = cam.zoom;
    const tileW = CONFIG.TILE_SIZE * zoom;
    const tileH = (CONFIG.TILE_SIZE / 2) * zoom;

    // İzometrik Dönüşüm
    const toIso = (x: number, y: number) => ({
      x: (x - y) * tileW + cvs.width/2 - cam.x,
      y: (x + y) * tileH + 200 - cam.y
    });

    // 1. Temizle
    ctx.fillStyle = '#1e272e';
    ctx.fillRect(0, 0, cvs.width, cvs.height);

    // 2. Harita
    for(let x=0; x<CONFIG.MAP_SIZE; x++) {
      for(let y=0; y<CONFIG.MAP_SIZE; y++) {
        const type = gs.current.map[x][y];
        const pos = toIso(x, y);
        
        // Ekranda değilse çizme (Culling)
        if (pos.x < -tileW || pos.x > cvs.width+tileW || pos.y < -tileH || pos.y > cvs.height+tileH) continue;

        ctx.fillStyle = type===1 ? CONFIG.COLORS.water : (type===2 ? CONFIG.COLORS.waterDeep : CONFIG.COLORS.grass);
        if((x+y)%2===0 && type===0) ctx.fillStyle = CONFIG.COLORS.grassDark; // Desen

        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x + tileW, pos.y + tileH);
        ctx.lineTo(pos.x, pos.y + tileH * 2);
        ctx.lineTo(pos.x - tileW, pos.y + tileH);
        ctx.fill();
      }
    }

    // 3. Varlıklar (Derinlik Sıralı)
    gs.current.entities.sort((a,b) => (a.pos.x+a.pos.y) - (b.pos.x+b.pos.y));
    gs.current.entities.forEach(ent => {
      const pos = toIso(ent.pos.x, ent.pos.y);
      const sprite = SpriteFactory.get(ent.type);
      const dw = CONFIG.TILE_SIZE * zoom;
      
      const drawX = pos.x - dw/2;
      const drawY = pos.y - dw;

      ctx.drawImage(sprite, drawX, drawY, dw, dw);

      // Can Barı (Sadece hasar almışsa)
      if(ent.hp < ent.maxHp) {
        ctx.fillStyle = 'red'; ctx.fillRect(drawX, drawY, dw, 4);
        ctx.fillStyle = '#00e676'; ctx.fillRect(drawX, drawY, dw*(ent.hp/ent.maxHp), 4);
      }
    });
  };

  // --- ETKİLEŞİMLER ---
  const saveGame = () => {
    if(!gs.current.userId) return;
    update(ref(db, `kingdoms/${gs.current.userId}`), {
      player: gs.current.player,
      entities: gs.current.entities,
      lastSave: serverTimestamp()
    });
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    // Tıklanan koordinatı bul (Basit yaklaşım: Mouse pozisyonuna göre yaklaşık grid)
    // Build Mode Aktifse
    if (buildMode) {
      if (gs.current.player.resources.wood >= 50) {
        gs.current.player.resources.wood -= 50;
        // Rastgele yakına bina koy (Gerçek versiyonda grid picking yapılır)
        const cx = Math.floor(CONFIG.MAP_SIZE/2) + Math.floor(Math.random()*10)-5;
        const cy = Math.floor(CONFIG.MAP_SIZE/2) + Math.floor(Math.random()*10)-5;
        
        gs.current.entities.push({
          id: `bld_${Date.now()}`, type: buildMode,
          pos: {x: cx, y: cy}, pixelPos: {x:0, y:0}, state: 'IDLE', hp: 500, maxHp: 500, owner: gs.current.userId!
        });
        
        setUiRes({...gs.current.player.resources});
        log(`${buildMode} inşa edildi.`);
        setBuildMode(null);
        saveGame();
      } else {
        log("Yetersiz Kaynak!");
      }
    }
  };

  const spawnWorker = () => {
    const cost = 50; // Yemek maliyeti
    if (gs.current.player.resources.food >= cost) {
      gs.current.player.resources.food -= cost;
      const cx = Math.floor(CONFIG.MAP_SIZE/2);
      gs.current.entities.push({
        id: `w_${Date.now()}`, type: 'worker',
        pos: {x: cx+1, y: cx+1}, pixelPos: {x:0, y:0}, state: 'IDLE', hp: 50, maxHp: 50, owner: gs.current.userId!
      });
      setUiRes({...gs.current.player.resources});
      log("İşçi eğitildi.");
      saveGame();
    } else {
      log("Yetersiz Yemek! (50 gerekli)");
    }
  };

  // --- UI RENDER ---
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-gray-900 text-white select-none font-sans">
      
      {/* ÜST PANEL: KAYNAKLAR */}
      <div className="absolute top-0 w-full p-4 flex justify-between z-10 pointer-events-none">
        <div className="flex gap-4 bg-black/60 backdrop-blur p-3 rounded-xl border border-white/10 pointer-events-auto">
          <ResItem icon="🌲" val={uiRes.wood} label="Odun" />
          <ResItem icon="🪨" val={uiRes.stone} label="Taş" />
          <ResItem icon="💰" val={uiRes.gold} label="Altın" color="text-yellow-400" />
          <ResItem icon="🍗" val={uiRes.food} label="Yemek" />
        </div>
        <div className="pointer-events-auto">
          <button onClick={() => setIsTechOpen(true)} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded font-bold shadow-lg transition">
            🧬 TEKNOLOJİ
          </button>
        </div>
      </div>

      {/* TECH MODAL */}
      {isTechOpen && (
        <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-gray-800 p-6 rounded-xl w-[500px] border border-gray-600">
            <div className="flex justify-between mb-4">
              <h2 className="text-xl font-bold">Teknoloji Ağacı</h2>
              <button onClick={() => setIsTechOpen(false)} className="text-red-400">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-green-900/40 border border-green-500 rounded">
                <h3 className="font-bold">Temel İnşaat</h3>
                <p className="text-xs text-gray-300">Ev ve Duvar yapımını açar.</p>
                <span className="text-green-400 text-xs">ARAŞTIRILDI</span>
              </div>
              <div className="p-3 bg-gray-700 border border-gray-600 rounded opacity-60">
                <h3 className="font-bold">Maden İşleme</h3>
                <p className="text-xs text-gray-300">Taş ocağı verimini artırır.</p>
                <span className="text-yellow-500 text-xs">500 Odun</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ALT PANEL: İNŞAAT */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-3 z-10 pointer-events-auto">
        <Btn icon="👷" label="İşçi" cost="50 Yemek" onClick={spawnWorker} />
        <div className="w-px bg-white/20 mx-2"></div>
        <Btn icon="🏠" label="Ev" cost="50 Odun" active={buildMode==='house'} onClick={() => setBuildMode(buildMode==='house'?null:'house')} />
        <Btn icon="🏯" label="Kule" cost="100 Taş" active={buildMode==='barracks'} onClick={() => setBuildMode(buildMode==='barracks'?null:'barracks')} />
      </div>

      {/* LOGLAR */}
      <div className="absolute bottom-4 right-4 flex flex-col items-end gap-1 pointer-events-none">
        {logs.map((l, i) => <div key={i} className="bg-black/70 px-3 py-1 rounded text-sm text-gray-200">{l}</div>)}
      </div>

      <canvas ref={canvasRef} onClick={handleCanvasClick} className="block w-full h-full cursor-crosshair" />
    </div>
  );
}

// UI YARDIMCILARI
const ResItem = ({icon, val, label, color="text-white"}: any) => (
  <div className="flex flex-col items-center min-w-[50px]">
    <span className="text-xl">{icon}</span>
    <span className={`font-mono font-bold ${color}`}>{val}</span>
    <span className="text-[10px] text-gray-400 uppercase">{label}</span>
  </div>
);

const Btn = ({icon, label, cost, onClick, active}: any) => (
  <button onClick={onClick} className={`flex flex-col items-center justify-center w-20 h-20 rounded-xl border-2 transition shadow-lg active:scale-95 ${active ? 'bg-blue-700 border-blue-400' : 'bg-gray-800 border-gray-600 hover:bg-gray-700 hover:border-gray-400'}`}>
    <span className="text-2xl mb-1">{icon}</span>
    <span className="text-[10px] font-bold uppercase">{label}</span>
    <span className="text-[9px] text-yellow-500">{cost}</span>
  </button>
);