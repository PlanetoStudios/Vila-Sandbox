const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const yokoDisplay = document.getElementById("yokoDisplay");

// Habilita suavização e melhores composições
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = "high";

// utilitário: desenha um brilho suave (bloom) ao redor de formas
function withGlow(color, blur, drawFn) {
  ctx.save();
  // desenha brilho por baixo
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.globalCompositeOperation = "lighter";
  drawFn();
  ctx.restore();
  // desenha o objeto normalmente depois (caller must draw)
}

// ajusta o canvas ao tamanho visível
function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

let mode = "human";
let world = "earth"; // 'earth', 'mars', 'moon'
let yoko = 0;
let lastTime = null;

 // controle de simulação
let isPaused = true; // start paused until the player clicks Jogar
let simSpeed = 1; // 1x, 2x, 4x, etc.

// Background music elements and start screen elements
const startScreen = document.getElementById("startScreen");
const playBtn = document.getElementById("playBtn");
const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const musicToggle = document.getElementById("musicToggle");
const bgMusic = document.getElementById("bgMusic");

// Basic music: try to set a sample track; if empty, the toggle will be silent but still functional.
// You can update the src to any valid URL (keeps file small here).
bgMusic.src = ""; // leave empty by default; user can paste a URL into the code if desired
bgMusic.volume = 0.32;
bgMusic.loop = true;
let musicEnabled = true;
musicToggle.checked = true;

// wire up start screen buttons
playBtn.addEventListener("click", () => {
  // hide the start screen and unpause simulation
  startScreen.style.display = "none";
  isPaused = false;
  // if music is enabled and a source exists, play it
  if (musicEnabled && bgMusic.src) {
    bgMusic.play().catch(() => {});
  }
});

settingsBtn.addEventListener("click", () => {
  // toggle panel visibility
  settingsPanel.style.display = settingsPanel.style.display === "flex" ? "none" : "flex";
});

musicToggle.addEventListener("change", () => {
  musicEnabled = musicToggle.checked;
  if (musicEnabled) {
    if (bgMusic.src) bgMusic.play().catch(() => {});
  } else {
    try { bgMusic.pause(); } catch (e) {}
  }
});

// botões de controle de simulação
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const speedBtns = document.querySelectorAll(".speedBtn");

function updateSpeedButtons() {
  speedBtns.forEach((btn) => {
    const s = Number(btn.dataset.speed);
    if (s === simSpeed) {
      btn.style.background = "#ff9800";
    } else {
      btn.style.background = "#555";
    }
  });
}

pauseBtn.addEventListener("click", () => {
  isPaused = !isPaused;
  pauseBtn.textContent = isPaused ? "▶️" : "⏸️";
});

resetBtn.addEventListener("click", () => {
  resetSim();
});

speedBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    simSpeed = Number(btn.dataset.speed) || 1;
    isPaused = false;
    pauseBtn.textContent = "⏸️";
    updateSpeedButtons();
  });
});

// estado inicial dos botões de velocidade
updateSpeedButtons();

// reset da simulação: limpa coleções, zera yoko e estado relacionado
function resetSim() {
  // esvazia arrays mantendo referências
  humans.length = 0;
  monsters.length = 0;
  gefs.length = 0;
  rhinos.length = 0;
  aliens.length = 0;
  golems.length = 0;
  resources.length = 0;
  houses.length = 0;
  farms.length = 0;
  markets.length = 0;
  gameShops.length = 0;
  mines.length = 0;
  cats.length = 0;
  dogs.length = 0;
  smallCities.length = 0;

  // reset estados
  draggingCity = null;
  dragOffsetX = 0;
  dragOffsetY = 0;
  didDragCity = false;
  smallCityCreated = false;

  yoko = 0;
  isPaused = true; // go back to paused so player can restart intentionally
  pauseBtn.textContent = "▶️";

  // show start screen again
  startScreen.style.display = "flex";

  // pause music
  try { bgMusic.pause(); } catch (e) {}

  // atualizar display e botões
  yokoDisplay.textContent = "Yoko: 0";
  updateSpeedButtons();
}

// troca de modo pelos botões da interface
document.querySelectorAll('#ui button[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    mode = btn.dataset.mode;
  });
});

  // world shape: 'complete' (all grass), 'four' (4 grass circles surrounded by water), 'half' (half grass half water)
let worldShape = "complete";

// helper: determine if a point is considered water based on current worldShape/world
function isWaterAt(px, py) {
  // bounds guard
  if (px < 0 || py < 0 || px > canvas.width || py > canvas.height) return false;

  if (worldShape === "complete") {
    // complete = no water
    return false;
  } else if (worldShape === "four") {
    // four islands: water everywhere except four circular islands
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = Math.min(canvas.width, canvas.height) * 0.20;
    const centers = [
      { x: cx * 0.5, y: cy * 0.5 },
      { x: cx * 1.5, y: cy * 0.5 },
      { x: cx * 0.5, y: cy * 1.5 },
      { x: cx * 1.5, y: cy * 1.5 },
    ];
    for (const c of centers) {
      if (Math.hypot(px - c.x, py - c.y) <= radius) return false; // on island => not water
    }
    return true; // otherwise water
  } else if (worldShape === "half") {
    const verticalSplit = canvas.width >= canvas.height;
    if (verticalSplit) {
      // left = grass, right = water
      return px > canvas.width / 2;
    } else {
      // top = grass, bottom = water
      return py > canvas.height / 2;
    }
  }
  return false;
}

// returns a small repulsion vector away from nearest water if the point is near water (within threshold)
function waterRepelVector(px, py) {
  const thresh = 36; // distance in px considered "near water"
  // quick check: if currently on water, push toward nearest land (stronger)
  if (isWaterAt(px, py)) {
    // sample neighboring directions to find nearest non-water
    const sampleCount = 16;
    let best = null;
    for (let i = 0; i < sampleCount; i++) {
      const ang = (Math.PI * 2 * i) / sampleCount;
      for (let r = 8; r <= 220; r += 8) {
        const sx = px + Math.cos(ang) * r;
        const sy = py + Math.sin(ang) * r;
        if (!isWaterAt(sx, sy)) {
          const dx = px - sx;
          const dy = py - sy;
          const len = Math.hypot(dx, dy) || 1;
          const vx = dx / len;
          const vy = dy / len;
          // stronger push when fully in water
          return { x: vx, y: vy, m: 1.4 };
        }
      }
    }
    return { x: 0, y: 0, m: 0 };
  } else {
    // if on land, check surrounding samples to see if near water edge
    const sampleCount = 12;
    let nearestDist = Infinity;
    let nearVec = { x: 0, y: 0 };
    for (let i = 0; i < sampleCount; i++) {
      const ang = (Math.PI * 2 * i) / sampleCount;
      for (let r = 6; r <= thresh; r += 6) {
        const sx = px + Math.cos(ang) * r;
        const sy = py + Math.sin(ang) * r;
        if (isWaterAt(sx, sy)) {
          if (r < nearestDist) {
            nearestDist = r;
            // vector pointing away from the water sample
            nearVec.x = (px - sx) / (r || 1);
            nearVec.y = (py - sy) / (r || 1);
          }
          break; // no need to check further along this ray
        }
      }
    }
    if (nearestDist <= thresh) {
      // magnitude scales stronger the closer to water
      const mag = 0.9 * (1 - nearestDist / thresh) + 0.15;
      return { x: nearVec.x, y: nearVec.y, m: mag };
    }
    return { x: 0, y: 0, m: 0 };
  }
}

// troca de mundo
document.querySelectorAll('#ui button[data-world]').forEach((btn) => {
  btn.addEventListener('click', () => {
    world = btn.dataset.world;
    // visual feedback
    document.querySelectorAll('#ui button[data-world]').forEach((b) => {
      b.style.outline = b === btn ? "2px solid #fff" : "none";
      b.style.opacity = b === btn ? "1" : "0.82";
    });
  });
});



const humans = [];
const monsters = [];
const gefs = [];
const rhinos = [];
const aliens = [];
const golems = []; // novo: golems de ferro
const resources = [];
const houses = [];
const farms = [];
const markets = [];
const gameShops = [];
const mines = [];
const cats = [];
const dogs = [];

// arraste de cidades pequenas
let draggingCity = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let didDragCity = false;

// cidades pequenas
const smallCities = [];
let smallCityCreated = false;

const resourcePower = {
  wood: 1,
  stone: 2,
  iron: 4,
  gold: 5,
  diamond: 8,
  ruby: 10,
  copper: 3,
  lapis: 4,
  sapphire: 7,
  netherite: 12,
  amandita: 16, // minério raro encontrado na mina
  topaz: 6,
  esmeralda: 7,
  ametista: 6,
  peridote: 5,
  aco: 5, // aço
  aquamarino: 6, // aquamarine gem
  platina: 5, // platinum metal
};

canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  draggingCity = null;
  didDragCity = false;

  // verificar se clicou em alguma cidade pequena
  for (let i = smallCities.length - 1; i >= 0; i--) {
    const city = smallCities[i];
    // hitbox simples ao redor da cidade
    if (Math.abs(x - city.x) < 60 && Math.abs(y - city.y) < 130) {
      draggingCity = city;
      dragOffsetX = x - city.x;
      dragOffsetY = y - city.y;
      break;
    }
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (!draggingCity) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  didDragCity = true;

  // atualizar posição da cidade, mantendo dentro dos limites
  const marginX = 60;
  const marginY = 130;
  draggingCity.x = Math.max(
    marginX,
    Math.min(canvas.width - marginX, x - dragOffsetX)
  );
  draggingCity.y = Math.max(
    marginY,
    Math.min(canvas.height - marginY, y - dragOffsetY)
  );
});

canvas.addEventListener("mouseup", () => {
  draggingCity = null;
});

// --- Suporte a toque para mover cidades pequenas no celular ---
canvas.addEventListener(
  "touchstart",
  (e) => {
    const touch = e.touches[0];
    if (!touch) return;
    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    draggingCity = null;
    didDragCity = false;

    for (let i = smallCities.length - 1; i >= 0; i--) {
      const city = smallCities[i];
      if (Math.abs(x - city.x) < 60 && Math.abs(y - city.y) < 130) {
        draggingCity = city;
        dragOffsetX = x - city.x;
        dragOffsetY = y - city.y;
        e.preventDefault();
        break;
      }
    }
  },
  { passive: false }
);

canvas.addEventListener(
  "touchmove",
  (e) => {
    if (!draggingCity) return;
    const touch = e.touches[0];
    if (!touch) return;
    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    didDragCity = true;

    const marginX = 60;
    const marginY = 130;
    draggingCity.x = Math.max(
      marginX,
      Math.min(canvas.width - marginX, x - dragOffsetX)
    );
    draggingCity.y = Math.max(
      marginY,
      Math.min(canvas.height - marginY, y - dragOffsetY)
    );

    e.preventDefault();
  },
  { passive: false }
);

canvas.addEventListener(
  "touchend",
  () => {
    draggingCity = null;
  },
  { passive: false }
);

canvas.addEventListener("click", (e) => {
  // se foi um arraste de cidade, não spawnar nada
  if (didDragCity) {
    didDragCity = false;
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (mode === "human") {
    // 15% dono de mercado, 5% criador de jogos, 10% escavador, 20% construtor, resto guerreiro normal
    const r = Math.random();
    let role = "normal";
    if (r < 0.15) role = "marketOwner";
    else if (r < 0.20) role = "gameDev"; // criador de jogos
    else if (r < 0.30) role = "miner"; // escavador
    else if (r < 0.50) role = "builder";
    humans.push(new Human(x, y, role));
  } else if (mode === "monster") {
    monsters.push(new Monster(x, y));
  } else if (mode === "gef") {
    const newGef = new Gef(x, y);
    gefs.push(newGef);
    buildGameShopsForGameCreators(newGef);
  } else if (mode === "rhino") {
    rhinos.push(new Rhino(x, y));
  } else if (mode === "alien") {
    aliens.push(new Alien(x, y));
  } else if (mode === "golem") {
    golems.push(new Golem(x, y));
  } else {
    resources.push(new Resource(x, y, mode));
  }
});

// encontra o alvo mais próximo em uma lista
function findNearest(source, list) {
  let nearest = null;
  let bestDist = Infinity;
  for (const item of list) {
    const d = dist(source, item);
    if (d < bestDist) {
      bestDist = d;
      nearest = item;
    }
  }
  return nearest;
}

class Human {
  constructor(x, y, role = "normal") {
    this.x = x;
    this.y = y;
    this.hp = 50;
    this.weapon = 1;
    this.weaponType = "none"; // tipo de espada atual (madeira, ferro, ouro, etc.)
    this.speed = 1.6;
    this.role = role; // normal, builder, farmer, marketOwner, miner, gameDev
    this.armorLevel = 0; // 0=sem, 1=ferro, 2=ouro, 3=diamante/rubi
    this.targetFarm = null;
    this.targetMine = null;

    // movement smoothing / real walking
    this.vx = 0;
    this.vy = 0;
    this.maxSpeed = this.speed; // base max
    this.moveTarget = { x: this.x + rand(-80, 80), y: this.y + rand(-80, 80) };
    this.retargetTimer = 0;
  }

  update() {
    // coletar recurso -> ganha espada do minério
    resources.forEach((r, i) => {
      if (dist(this, r) < 15) {
        const power = resourcePower[r.type] || 1;
        // sempre que coleta, atualiza para a espada daquele minério
        if (power >= this.weapon) {
          this.weapon = power;
          this.weaponType = r.type;
        }
        resources.splice(i, 1);
      }
    });

    // arma -> nível de armadura visual
    if (this.weapon >= resourcePower.ruby) this.armorLevel = 3;
    else if (this.weapon >= resourcePower.diamond) this.armorLevel = 3;
    else if (this.weapon >= resourcePower.gold) this.armorLevel = 2;
    else if (this.weapon >= resourcePower.iron) this.armorLevel = 1;

    // atacar monstro
    monsters.forEach((m, i) => {
      if (dist(this, m) < 20) {
        m.hp -= this.weapon;
        if (m.hp <= 0) monsters.splice(i, 1);
      }
    });

    // chance pequena de virar fazendeiro se houver fazendas
    if (this.role === "normal" && farms.length > 0 && Math.random() < 0.0005) {
      this.role = "farmer";
    }

    if (this.role === "builder") {
      this.updateBuilder();
    } else if (this.role === "farmer") {
      this.updateFarmer();
    } else if (this.role === "marketOwner") {
      this.updateMarketOwner();
    } else if (this.role === "miner") {
      this.updateMiner();
    } else if (this.role === "gameDev") {
      this.updateGameDev();
    } else {
      this.updateFighterGatherer();
    }

    // mantém dentro da tela
    this.x = Math.max(5, Math.min(canvas.width - 5, this.x));
    this.y = Math.max(5, Math.min(canvas.height - 5, this.y));
  }

  updateFighterGatherer() {
    // IA de movimento aprimorada:
    const nearestResource = findNearest(this, resources);
    const nearestMonster = findNearest(this, monsters);
    const nearestRhino = findNearest(this, rhinos);

    let dirX = 0;
    let dirY = 0;

    // prioridade: manter distância segura de rinocerontes (mais suave, com predição)
    if (nearestRhino) {
      const dxR = nearestRhino.x - this.x;
      const dyR = nearestRhino.y - this.y;
      const dR = Math.hypot(dxR, dyR) || 1;
      if (dR < 140) {
        // predita posição do rinoceronte para reagir mais naturalmente
        const predX = nearestRhino.x + (nearestRhino.x - (nearestRhino.prevX || nearestRhino.x)) * 6;
        const predY = nearestRhino.y + (nearestRhino.y - (nearestRhino.prevY || nearestRhino.y)) * 6;
        const awayX = this.x - predX;
        const awayY = this.y - predY;
        const len = Math.hypot(awayX, awayY) || 1;
        dirX += (awayX / len) * (1.6 * Math.min(1.6, (140 - dR) / 80 + 0.6));
        dirY += (awayY / len) * (1.6 * Math.min(1.6, (140 - dR) / 80 + 0.6));
      }
    }

    // atacar/perseguir monstros quando apropriado: avalia perigo antes de atacar
    if (nearestMonster) {
      const dx = nearestMonster.x - this.x;
      const dy = nearestMonster.y - this.y;
      const len = Math.hypot(dx, dy) || 1;
      // se houver muitos inimigos próximos, prioriza recuar ao invés de correr para dentro
      const closeThreats = monsters.filter(m => dist(this, m) < 80).length;
      if (closeThreats <= 2) {
        dirX += dx / len;
        dirY += dy / len;
      } else {
        // recua um pouco para reagrupar
        dirX -= dx / len * 0.6;
        dirY -= dy / len * 0.6;
      }
    } else if (nearestResource) {
      // ir atrás de recurso mais próximo de forma ponderada (evita correr direto para água)
      const dx = nearestResource.x - this.x;
      const dy = nearestResource.y - this.y;
      const len = Math.hypot(dx, dy) || 1;
      // se recurso muito perto de água, tenta uma abordagem lateral
      const repelSample = waterRepelVector(nearestResource.x, nearestResource.y);
      if (repelSample.m > 0.6) {
        // approach from an offset to avoid getting stuck on water edges
        const offsetX = -dy / (len || 1) * 12;
        const offsetY = dx / (len || 1) * 12;
        dirX += (dx + offsetX) / Math.hypot(dx + offsetX, dy + offsetY);
        dirY += (dy + offsetY) / Math.hypot(dx + offsetX, dy + offsetY);
      } else {
        dirX += dx / len;
        dirY += dy / len;
      }
    }

    // farm logic: busca comida se estiver ferido (mais clara prioridade)
    if (this.hp < 80 && farms.length > 0) {
      const nearestFarm = findNearest(this, farms);
      if (nearestFarm) {
        const dx = nearestFarm.x - this.x;
        const dy = nearestFarm.y - this.y;
        const len = Math.hypot(dx, dy) || 1;
        dirX += (dx / len) * 0.9;
        dirY += (dy / len) * 0.9;

        if (dist(this, nearestFarm) < 18 && nearestFarm.food > 1) {
          nearestFarm.food -= 1;
          this.hp = Math.min(100, this.hp + 10);
        }
      }
    }

    // reforçar esquiva de água com peso variável dependendo da proximidade
    const repel = waterRepelVector(this.x, this.y);
    if (repel.m > 0) {
      // se estiver totalmente na água, empurra com força; se perto, aplica suavemente
      const weight = isWaterAt(this.x, this.y) ? 2.0 : 1.1 + repel.m * 0.7;
      dirX += repel.x * repel.m * weight;
      dirY += repel.y * repel.m * weight;
    }

    // suaviza ruído baseado em situação (menos ruído quando em combate/fuga)
    let noiseMag = 0.12;
    if (nearestRhino || nearestMonster) noiseMag = 0.07;
    dirX += rand(-noiseMag, noiseMag);
    dirY += rand(-noiseMag, noiseMag);

    // aplica movimento com suavização e colisão leve com outros humanos (ajuda a formar grupos)
    this.applyMovement(dirX, dirY, this.speed);
  }

  // movement helper: smooth velocity, avoid jitter, respect maxSpeed, and soft-collide with peers
  applyMovement(dirX, dirY, baseSpeed) {
    // normalize desired direction
    let len = Math.hypot(dirX, dirY);
    if (len < 0.001) {
      // small wander if no direction
      dirX = Math.cos((this._wanderSeed = (this._wanderSeed || Math.random()) + 0.01));
      dirY = Math.sin((this._wanderSeed));
      len = Math.hypot(dirX, dirY);
    }
    dirX /= len;
    dirY /= len;

    // target speed modulation: slower when low HP or carrying tasks
    let speedFactor = 1.0;
    if (this.hp < 40) speedFactor = 0.68;
    if (this.role === "farmer") speedFactor *= 0.8;
    if (this.role === "builder") speedFactor *= 0.95;
    const targetSpeed = baseSpeed * speedFactor;

    // avoid clustering too tightly with other humans (separation)
    let sepX = 0, sepY = 0;
    for (const other of humans) {
      if (other === this) continue;
      const d = Math.hypot(this.x - other.x, this.y - other.y);
      if (d > 0 && d < 18) {
        sepX += (this.x - other.x) / d;
        sepY += (this.y - other.y) / d;
      }
    }
    // add small separation influence
    dirX += sepX * 0.9;
    dirY += sepY * 0.9;

    // compute desired velocity
    const desiredVX = (dirX * targetSpeed);
    const desiredVY = (dirY * targetSpeed);

    // inertia smoothing: lerp current velocity towards desired velocity
    const inertia = 0.14; // lower = more responsive, higher = smoother
    this.vx = this.vx + (desiredVX - this.vx) * (1 - Math.pow(inertia, 1));
    this.vy = this.vy + (desiredVY - this.vy) * (1 - Math.pow(inertia, 1));

    // clamp speed to targetSpeed * 1.25 to avoid bursts
    const curSpeed = Math.hypot(this.vx, this.vy) || 1;
    const maxAllow = targetSpeed * 1.25;
    if (curSpeed > maxAllow) {
      this.vx = (this.vx / curSpeed) * maxAllow;
      this.vy = (this.vy / curSpeed) * maxAllow;
    }

    // step position with subtle collision resolution against world edges and water
    this.x += this.vx;
    this.y += this.vy;

    // soft collision with world bounds
    if (this.x < 6) this.x = 6, this.vx *= -0.25;
    if (this.x > canvas.width - 6) this.x = canvas.width - 6, this.vx *= -0.25;
    if (this.y < 6) this.y = 6, this.vy *= -0.25;
    if (this.y > canvas.height - 6) this.y = canvas.height - 6, this.vy *= -0.25;
  }

  updateBuilder() {
    // construtor melhora casas existentes e cria fazendas
    let targetHouse = null;
    let bestDist = Infinity;
    for (const h of houses) {
      if (h.level < 2) {
        const d = dist(this, h);
        if (d < bestDist) {
          bestDist = d;
          targetHouse = h;
        }
      }
    }

    let dirX = 0;
    let dirY = 0;

    if (targetHouse) {
      const dx = targetHouse.x - this.x;
      const dy = targetHouse.y - this.y;
      const len = Math.hypot(dx, dy) || 1;
      dirX = dx / len;
      dirY = dy / len;

      if (bestDist < 18) {
        // evoluir casa
        targetHouse.level = 2;
        // ao evoluir casa, chance de aparecer um animal
        spawnHouseAnimal(targetHouse.x, targetHouse.y);
      }
    } else {
      // nenhuma casa para evoluir -> construir fazenda perto da casa mais próxima
      const baseHouse = findNearest(this, houses);
      if (baseHouse && farms.length < humans.length) {
        if (dist(this, baseHouse) < 40) {
          // tentar posicionar fazenda
          const fx = baseHouse.x + rand(-50, 50);
          const fy = baseHouse.y + rand(-50, 50);
          if (
            fx > 20 &&
            fy > 20 &&
            fx < canvas.width - 20 &&
            fy < canvas.height - 20
          ) {
            farms.push(new Farm(fx, fy));
          }
        } else {
          const dx = baseHouse.x - this.x;
          const dy = baseHouse.y - this.y;
          const len = Math.hypot(dx, dy) || 1;
          dirX = dx / len;
          dirY = dy / len;
        }
      }
    }

    dirX += rand(-0.15, 0.15);
    dirY += rand(-0.15, 0.15);

    const len = Math.hypot(dirX, dirY) || 1;
    this.x += (dirX / len) * this.speed;
    this.y += (dirY / len) * this.speed;
  }

  updateFarmer() {
    // fazendeiro procura fazenda para trabalhar
    if (!this.targetFarm || farms.indexOf(this.targetFarm) === -1) {
      this.targetFarm = findNearest(this, farms);
    }

    let dirX = 0;
    let dirY = 0;

    if (this.targetFarm) {
      const dx = this.targetFarm.x - this.x;
      const dy = this.targetFarm.y - this.y;
      const d = Math.hypot(dx, dy) || 1;

      if (d > 10) {
        dirX = dx / d;
        dirY = dy / d;
      } else {
        // plantando / cuidando
        this.targetFarm.food = Math.min(
          this.targetFarm.food + 0.03,
          this.targetFarm.maxFood
        );
      }
    }

    // farmers avoid water edges when tending fields
    const repelF = waterRepelVector(this.x, this.y);
    if (repelF.m > 0) {
      dirX += repelF.x * repelF.m * 0.9;
      dirY += repelF.y * repelF.m * 0.9;
    }

    dirX += rand(-0.1, 0.1);
    dirY += rand(-0.1, 0.1);

    // smooth movement (slower for farmers)
    this.applyMovement(dirX, dirY, this.speed * 0.8);
  }

  updateMiner() {
    // se não existe mina ainda, comportamento parecido com guerreiro,
    // mas com foco em ficar perto de GEFs para facilitar construção da mina
    if (mines.length === 0) {
      const nearestGef = findNearest(this, gefs);
      let dirX = 0;
      let dirY = 0;

      if (nearestGef) {
        const dx = nearestGef.x - this.x;
        const dy = nearestGef.y - this.y;
        const d = Math.hypot(dx, dy) || 1;
        dirX = dx / d;
        dirY = dy / d;
      }

      dirX += rand(-0.15, 0.15);
      dirY += rand(-0.15, 0.15);

      const len = Math.hypot(dirX, dirY) || 1;
      this.x += (dirX / len) * (this.speed * 0.9);
      this.y += (dirY / len) * (this.speed * 0.9);
      return;
    }

    // com mina criada, escavador vai até ela para trabalhar
    if (!this.targetMine || mines.indexOf(this.targetMine) === -1) {
      this.targetMine = mines[0];
    }

    let dirX = 0;
    let dirY = 0;

    if (this.targetMine) {
      const dx = this.targetMine.x - this.x;
      const dy = this.targetMine.y - this.y;
      const d = Math.hypot(dx, dy) || 1;

      if (d > 14) {
        dirX = dx / d;
        dirY = dy / d;
      } else {
        // "trabalhando" dentro da mina: fica andando em volta devagar
        dirX += rand(-0.05, 0.05);
        dirY += rand(-0.05, 0.05);
      }
    }

    // smooth movement for miners
    this.applyMovement(dirX, dirY, this.speed * 0.8);
  }

  updateMarketOwner() {
    // donos de mercado se movem mais perto dos mercados, se existirem,
    // senão andam perto das casas (como se estivessem procurando lugar para vender)
    let dirX = 0;
    let dirY = 0;

    let target = null;
    if (markets.length > 0) {
      target = findNearest(this, markets);
    } else if (houses.length > 0) {
      target = findNearest(this, houses);
    }

    if (target) {
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 15) {
        dirX = dx / d;
        dirY = dy / d;
      }
    }

    dirX += rand(-0.15, 0.15);
    dirY += rand(-0.15, 0.15);

    this.applyMovement(dirX, dirY, this.speed * 0.9);
  }

  updateGameDev() {
    // Criador de Jogos gosta de ficar perto de lojas de jogos ou GEFs
    let dirX = 0;
    let dirY = 0;

    let target = null;
    if (gameShops.length > 0) {
      target = findNearest(this, gameShops);
    } else if (gefs.length > 0) {
      target = findNearest(this, gefs);
    } else if (houses.length > 0) {
      target = findNearest(this, houses);
    }

    if (target) {
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 20) {
        dirX = dx / d;
        dirY = dy / d;
      }
    }

    dirX += rand(-0.1, 0.1);
    dirY += rand(-0.1, 0.1);

    const len = Math.hypot(dirX, dirY) || 1;
    this.x += (dirX / len) * (this.speed * 0.85);
    this.y += (dirY / len) * (this.speed * 0.85);
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    // health bar (humans max 50)
    drawHealthBar(0, -36, this.hp, 50);

    // soft ground shadow
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(0, 8, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // body base (shirt) - distinct palettes per profession with layered gradients for fabric feel
    const palettes = {
      normal: { base: "#3b82f6", accent: "#2b6ef2" },
      builder: { base: "#d9a83a", accent: "#c78f2e" },
      farmer: { base: "#4aa04a", accent: "#3b8a3b" },
      marketOwner: { base: "#b55bde", accent: "#9b43c8" },
      gameDev: { base: "#ff8a3c", accent: "#ff6a00" },
      miner: { base: "#f0c94a", accent: "#d6ab36" },
    };
    const p = palettes[this.role] || palettes.normal;
    const shirtGrad = ctx.createLinearGradient(0, -10, 0, 10);
    shirtGrad.addColorStop(0, lightenColor(p.base, 0.26));
    shirtGrad.addColorStop(0.5, p.base);
    shirtGrad.addColorStop(1, darkenColor(p.accent, 0.06));
    ctx.fillStyle = shirtGrad;
    ctx.beginPath();
    ctx.roundRect(-9, -9, 18, 16, 5);
    ctx.fill();

    // stitched collar and seams for textile detail
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-4, -2);
    ctx.lineTo(4, -2);
    ctx.stroke();

    // waist band / pockets variation by role
    ctx.fillStyle = darkenColor(p.accent, 0.18);
    ctx.beginPath();
    ctx.roundRect(-7, 0, 14, 5, 2);
    ctx.fill();
    // subtle pocket outlines
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-3, 1);
    ctx.lineTo(-3, 4);
    ctx.moveTo(3, 1);
    ctx.lineTo(3, 4);
    ctx.stroke();

    // legs & boots (slightly varied tones to match role)
    const legCol = this.role === "farmer" ? "#2f4f2f" : "#2b2b2b";
    ctx.fillStyle = legCol;
    ctx.beginPath();
    ctx.roundRect(-6, 6, 5, 9, 2);
    ctx.roundRect(1, 6, 5, 9, 2);
    ctx.fill();

    ctx.fillStyle = "#463322";
    ctx.beginPath();
    ctx.roundRect(-8, 15, 9, 5, 2);
    ctx.roundRect(0, 15, 9, 5, 2);
    ctx.fill();

    // head: broader palette for skin tones using mild variation by role (adds diversity)
    const skinVariants = ["#f0c9a0", "#f4d1b1", "#e5b58a", "#ffdcc2"];
    const skin = skinVariants[(Math.floor((this.x + this.y) * 0.001) + (this.role.length || 0)) % skinVariants.length];
    const headGrad = ctx.createLinearGradient(0, -18, 0, -6);
    headGrad.addColorStop(0, lightenColor(skin, 0.18));
    headGrad.addColorStop(0.5, skin);
    headGrad.addColorStop(1, darkenColor(skin, 0.12));
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.arc(0, -11, 6, 0, Math.PI * 2);
    ctx.fill();

    // rim highlight for separation
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, -11, 6.2, -Math.PI * 0.3, Math.PI * 0.7);
    ctx.stroke();

    // facial features (eyes/nose/mouth) - small expressive tweaks
    ctx.fillStyle = "#090909";
    ctx.beginPath();
    ctx.arc(-1.6, -12.4, 0.8, 0, Math.PI * 2);
    ctx.arc(1.6, -12.4, 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(-1.1, -12.8, 0.22, 0, Math.PI * 2);
    ctx.arc(2.1, -12.8, 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(50,30,20,0.72)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-0.2, -11.2);
    ctx.lineTo(-0.2, -10.0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-2.6, -9.3);
    ctx.quadraticCurveTo(0, -8.6, 2.6, -9.3);
    ctx.stroke();

    // hair: role-tinted small variations
    let hairCol = "#2b1d10";
    if (this.role === "gameDev") hairCol = "#171717";
    if (this.role === "farmer") hairCol = "#4a351f";
    if (this.role === "miner") hairCol = "#3a2b18";
    if (this.role === "marketOwner") hairCol = "#49264a";
    const hairGrad = ctx.createLinearGradient(0, -20, 0, -8);
    hairGrad.addColorStop(0, lightenColor(hairCol, 0.06));
    hairGrad.addColorStop(1, darkenColor(hairCol, 0.14));
    ctx.fillStyle = hairGrad;
    ctx.beginPath();
    ctx.moveTo(-6, -15);
    ctx.quadraticCurveTo(0, -20, 6, -15);
    ctx.lineTo(6, -11);
    ctx.quadraticCurveTo(0, -16, -6, -11);
    ctx.closePath();
    ctx.fill();

    // Role-specific clothing details & accessories (clear visual cues)
    ctx.save();
    if (this.role === "builder") {
      // tool belt, helmet strap, and wrist tool
      ctx.fillStyle = "#8b5e2b";
      ctx.fillRect(-10, 6, 20, 5);
      ctx.fillStyle = "#d4af70";
      ctx.beginPath();
      ctx.roundRect(-6, -20, 12, 6, 2); // compact helmet top
      ctx.fill();
      // tool hanging
      ctx.fillStyle = "#6b4f2c";
      ctx.fillRect(6, 2, 3, 8);
      // small hammer icon on belt
      ctx.fillStyle = "#333";
      ctx.fillRect(-2, 7, 4, 2);
    } else if (this.role === "farmer") {
      // straw hat, suspenders and dirt smudges
      ctx.fillStyle = "#e6c07a";
      ctx.beginPath();
      ctx.ellipse(0, -16, 9, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#8b5a2b";
      ctx.fillRect(-6, 1, 3, 8);
      ctx.fillRect(3, 1, 3, 8);
      // dirt smudge
      ctx.fillStyle = "rgba(60,40,20,0.12)";
      ctx.beginPath();
      ctx.arc(-3, 4, 2.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.role === "marketOwner") {
      // satchel and necklace tag
      ctx.fillStyle = "#7b4a85";
      ctx.beginPath();
      ctx.roundRect(-14, -2, 6, 10, 2);
      ctx.fill();
      ctx.fillStyle = "#ffd05a";
      ctx.beginPath();
      ctx.arc(8, -2, 2.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.role === "gameDev") {
      // headset / glasses and a badge
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-8, -12);
      ctx.lineTo(8, -12);
      ctx.stroke();
      ctx.fillStyle = "#1e1e1e";
      ctx.beginPath();
      ctx.roundRect(6, -4, 8, 6, 2);
      ctx.fill();
      // small green LED on device
      ctx.fillStyle = "#4caf50";
      ctx.beginPath();
      ctx.arc(10.5, -1, 0.7, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.role === "miner") {
      // miner helmet with light and reinforced gloves
      ctx.fillStyle = "#d6b14a";
      ctx.beginPath();
      ctx.roundRect(-7, -22, 14, 8, 3);
      ctx.fill();
      // lamp
      withGlow("rgba(255,240,140,0.9)", 14, () => {
        ctx.fillStyle = "#fff7d8";
        ctx.beginPath();
        ctx.arc(0, -18, 3, 0, Math.PI * 2);
        ctx.fill();
      });
      // reinforced gloves
      ctx.fillStyle = "#6b6b6b";
      ctx.beginPath();
      ctx.roundRect(-12, 10, 6, 6, 2);
      ctx.roundRect(6, 10, 6, 6, 2);
      ctx.fill();
    } else {
      // default fighter: small cloak and arm wrapping
      ctx.fillStyle = "rgba(30,30,30,0.18)";
      ctx.beginPath();
      ctx.roundRect(-12, -2, 6, 10, 3);
      ctx.fill();
    }
    ctx.restore();

    // armor insignia (if any)
    if (this.armorLevel > 0) {
      const acol =
        this.armorLevel === 1 ? "#b7bcc5" : this.armorLevel === 2 ? "#ffd94a" : "#88f0ff";
      ctx.fillStyle = acol;
      ctx.beginPath();
      ctx.arc(-3.2, -1.2, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // profession label (cleaner placement)
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.font = "9px Arial";
    ctx.textAlign = "center";
    let label = "Guerreiro";
    if (this.role === "builder") label = "Construtor";
    else if (this.role === "farmer") label = "Fazendeiro";
    else if (this.role === "marketOwner") label = "Mercado";
    else if (this.role === "miner") label = "Escavador";
    else if (this.role === "gameDev") label = "Dev Jogos";
    ctx.fillText(label, 0, -24);

    ctx.restore();
  }
}

class Monster {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.hp = 30;
    this.speed = 1.1;
  }

  update() {
    // atacar humanos em alcance
    humans.forEach((h, i) => {
      if (dist(this, h) < 20) {
        h.hp -= 1.5;
        if (h.hp <= 0) humans.splice(i, 1);
      }
    });

    // IA: perseguir o humano mais próximo
    const nearestHuman = findNearest(this, humans);

    let dirX = 0;
    let dirY = 0;

    if (nearestHuman) {
      const dx = nearestHuman.x - this.x;
      const dy = nearestHuman.y - this.y;
      const len = Math.hypot(dx, dy) || 1;
      dirX = dx / len;
      dirY = dy / len;
    }

    // leve ruído para não ficar totalmente linear
    dirX += rand(-0.15, 0.15);
    dirY += rand(-0.15, 0.15);

    const len = Math.hypot(dirX, dirY) || 1;
    this.x += (dirX / len) * this.speed;
    this.y += (dirY / len) * this.speed;

    // mantém dentro da tela
    this.x = Math.max(6, Math.min(canvas.width - 6, this.x));
    this.y = Math.max(6, Math.min(canvas.height - 6, this.y));
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    // health bar (monsters max 30)
    drawHealthBar(0, -36, this.hp, 30);

    // richer soft shadow with slight color tint for atmosphere
    const shadowGrad = ctx.createRadialGradient(0, 10, 6, 0, 14, 28);
    shadowGrad.addColorStop(0, "rgba(0,0,0,0.42)");
    shadowGrad.addColorStop(1, "rgba(0,0,0,0.06)");
    ctx.fillStyle = shadowGrad;
    ctx.beginPath();
    ctx.ellipse(0, 12, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // body color palette variation (richer, more organic)
    const baseColor = "#a31b2a"; // deeper red
    const midTone = lightenColor(baseColor, 0.06);
    const darkTone = darkenColor(baseColor, 0.28);

    // layered body gradient for subtle banding and depth
    const bodyGrad = ctx.createLinearGradient(0, -14, 0, 18);
    bodyGrad.addColorStop(0, lightenColor(midTone, 0.14));
    bodyGrad.addColorStop(0.4, midTone);
    bodyGrad.addColorStop(0.65, baseColor);
    bodyGrad.addColorStop(1, darkTone);

    // outer silhouette - slightly more dynamic shape
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(-14, -12);
    ctx.quadraticCurveTo(-12, -22, -6, -26);
    ctx.lineTo(6, -26);
    ctx.quadraticCurveTo(12, -22, 14, -12);
    ctx.quadraticCurveTo(8, 10, -8, 12);
    ctx.closePath();
    ctx.fill();

    // fine mottling: layered oval speckles with varied alpha and hue shifts
    for (let i = 0; i < 8; i++) {
      ctx.globalAlpha = 0.06 + Math.random() * 0.06;
      const ox = rand(-9, 9);
      const oy = rand(-8, 8);
      const rw = 5 + Math.random() * 8;
      const rh = 2 + Math.random() * 5;
      const hueShift = i % 2 === 0 ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.04)";
      ctx.fillStyle = hueShift;
      ctx.beginPath();
      ctx.ellipse(ox, oy, rw, rh, rand(-0.6, 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // subtle scale bands using stroked arcs (gives reptilian texture)
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 0.8;
    for (let s = -8; s <= 10; s += 4) {
      ctx.beginPath();
      ctx.moveTo(-10, s);
      ctx.quadraticCurveTo(0, s - 2, 10, s);
      ctx.stroke();
    }

    // stronger rim highlight to sell volume with warm tint
    ctx.strokeStyle = "rgba(255,180,140,0.08)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-14, -12);
    ctx.quadraticCurveTo(-12, -22, -6, -26);
    ctx.lineTo(6, -26);
    ctx.quadraticCurveTo(12, -22, 14, -12);
    ctx.quadraticCurveTo(8, 10, -8, 12);
    ctx.closePath();
    ctx.stroke();

    // enhanced horns: thicker base, tapered tip, with darker cracks
    const hornGrad = ctx.createLinearGradient(-12, -28, -4, -12);
    hornGrad.addColorStop(0, "#fff8f0");
    hornGrad.addColorStop(0.4, "#e7d8c8");
    hornGrad.addColorStop(1, "#bfb2a5");
    ctx.fillStyle = hornGrad;
    ctx.beginPath();
    ctx.moveTo(-5, -14);
    ctx.lineTo(-16, -30);
    ctx.lineTo(-2, -12);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(5, -14);
    ctx.lineTo(16, -30);
    ctx.lineTo(2, -12);
    ctx.closePath();
    ctx.fill();

    // horn cracks / texture
    ctx.strokeStyle = "rgba(60,50,45,0.6)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      const sx = (i % 2 === 0) ? -12 + i : 8 + i;
      ctx.moveTo(sx, -20 + i * 1.8);
      ctx.quadraticCurveTo(sx + 2, -22 + i * 1.6, sx + 1, -24 + i * 1.4);
      ctx.stroke();
    }

    // dorsal ridges: layered plates with subtle speculars
    for (let i = -8; i <= 8; i += 5) {
      const plateGrad = ctx.createLinearGradient(i - 3, -18, i + 3, -6);
      plateGrad.addColorStop(0, darkenColor(baseColor, 0.02));
      plateGrad.addColorStop(1, darkenColor(baseColor, 0.18));
      ctx.fillStyle = plateGrad;
      ctx.beginPath();
      ctx.moveTo(i, -8);
      ctx.lineTo(i - 6, -16);
      ctx.lineTo(i + 6, -16);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // eyes: stronger glow, slit pupil and subtle lens sheen
    const eyeColor = "rgba(255,210,120,0.98)";
    withGlow("rgba(255,200,120,0.88)", 16, () => {
      ctx.fillStyle = eyeColor;
      ctx.beginPath();
      ctx.ellipse(-4, -6, 3.6, 4.6, 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(4, -6, 3.6, 4.6, -0.18, 0, Math.PI * 2);
      ctx.fill();
    });

    // pupil & inner dark for menace
    ctx.fillStyle = "#060606";
    ctx.beginPath();
    ctx.ellipse(-4, -6, 1.2, 2.0, 0.18, 0, Math.PI * 2);
    ctx.ellipse(4, -6, 1.2, 2.0, -0.18, 0, Math.PI * 2);
    ctx.fill();
    // small specular on eye
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(-2.8, -7.8, 0.8, 0, Math.PI * 2);
    ctx.arc(5.2, -8.0, 0.6, 0, Math.PI * 2);
    ctx.fill();

    // mouth interior darker with glossy lip
    ctx.fillStyle = "#221010";
    ctx.beginPath();
    ctx.roundRect(-10, -2, 20, 10, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // jagged teeth with variation and small cracks
    ctx.fillStyle = "#fffaf0";
    for (let i = -7; i <= 7; i += 3.5) {
      ctx.beginPath();
      const top = 4 + Math.random() * 2;
      ctx.moveTo(i, top + 2);
      ctx.lineTo(i + 1.8, -1);
      ctx.lineTo(i + 3.6, top + 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // scars and battle markings: layered strokes with slight color variations
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-9, -4);
    ctx.lineTo(-4, -1);
    ctx.moveTo(-6, -2);
    ctx.lineTo(-2, 2);
    ctx.stroke();

    // add biolum spots for visual interest (pulsing)
    const t = (Date.now() % 1200) / 1200;
    const pulse = 0.6 + Math.sin(t * Math.PI * 2) * 0.25;
    const spots = [
      { x: -6, y: -2, s: 1.6, c: "rgba(255,160,90,0.95)" },
      { x: 5, y: 0, s: 1.3, c: "rgba(255,200,80,0.85)" },
    ];
    spots.forEach((sp, i) => {
      withGlow(sp.c, 10 + i * 4, () => {
        ctx.fillStyle = sp.c;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.s * (0.9 + 0.2 * pulse), 0, Math.PI * 2);
        ctx.fill();
      });
    });

    // claws on lower body with metallic sheen
    ctx.fillStyle = darkenColor(baseColor, 0.3);
    for (let cx = -8; cx <= 8; cx += 8) {
      ctx.beginPath();
      ctx.roundRect(cx - 3, 14, 6, 6, 2);
      ctx.fill();
      // small specular
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // subtle contact contour to the ground
    ctx.strokeStyle = "rgba(0,0,0,0.26)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-12, 14);
    ctx.quadraticCurveTo(0, 18, 12, 14);
    ctx.stroke();

    ctx.restore();
  }
}

class Rhino {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.hp = 85; // bem mais forte que o monstro
    this.speed = 1.8;
    this.state = "hunt"; // hunt, charge, retreat, wander
    this.target = null;
    this.chargeCooldown = 0;
    this.retreatTimer = 0;
  }

  update() {
    // atacar humanos próximos
    for (let i = humans.length - 1; i >= 0; i--) {
      const h = humans[i];
      const d = dist(this, h);
      if (d < 26) {
        // dano alto
        h.hp -= 3.5;
        if (h.hp <= 0) humans.splice(i, 1);
      }
    }

    // reduz cooldowns
    if (this.chargeCooldown > 0) this.chargeCooldown--;
    if (this.retreatTimer > 0) this.retreatTimer--;

    // escolher alvo humano mais próximo
    if (!this.target || humans.indexOf(this.target) === -1) {
      this.target = findNearest(this, humans);
    }

    // contar quantos humanos estão perto do rinoceronte
    let nearbyHumans = 0;
    for (const h of humans) {
      if (dist(this, h) < 80) nearbyHumans++;
    }

    // IA de alto nível:
    // - se há muitos humanos na volta, ele recua
    // - se tem um alvo isolado, ele entra em "charge"
    // - senão, caça normalmente
    if (nearbyHumans >= 4 && this.retreatTimer === 0) {
      this.state = "retreat";
      this.retreatTimer = 120;
    } else if (this.target && nearbyHumans <= 2 && this.chargeCooldown === 0) {
      this.state = "charge";
      this.chargeCooldown = 180;
    } else if (!this.target) {
      this.state = "wander";
    } else if (this.state !== "retreat") {
      this.state = "hunt";
    }

    let dirX = 0;
    let dirY = 0;
    let speed = this.speed;

    if (this.state === "charge" && this.target) {
      // investida rápida em linha quase reta
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const len = Math.hypot(dx, dy) || 1;
      dirX = dx / len;
      dirY = dy / len;
      speed *= 2.4;
    } else if (this.state === "hunt" && this.target) {
      // caça "esperta": chega um pouco ao lado do alvo
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const len = Math.hypot(dx, dy) || 1;
      dirX = dx / len;
      dirY = dy / len;

      // leve desvio lateral para não ir sempre reto
      const side = dx * 0.0 + dy * 0.0; // placeholder, já temos ruído abaixo
    } else if (this.state === "retreat") {
      // corre para longe do centro dos humanos próximos
      let centerX = 0;
      let centerY = 0;
      let count = 0;
      for (const h of humans) {
        if (dist(this, h) < 100) {
          centerX += h.x;
          centerY += h.y;
          count++;
        }
      }
      if (count > 0) {
        centerX /= count;
        centerY /= count;
        const dx = this.x - centerX;
        const dy = this.y - centerY;
        const len = Math.hypot(dx, dy) || 1;
        dirX = dx / len;
        dirY = dy / len;
        speed *= 1.6;
      } else {
        this.state = "wander";
      }
    } else {
      // wander
      dirX = rand(-1, 1);
      dirY = rand(-1, 1);
    }

    // ruído pequeno para o movimento
    dirX += rand(-0.1, 0.1);
    dirY += rand(-0.1, 0.1);

    const len = Math.hypot(dirX, dirY) || 1;
    this.x += (dirX / len) * speed;
    this.y += (dirY / len) * speed;

    // mantém dentro da tela
    this.x = Math.max(12, Math.min(canvas.width - 12, this.x));
    this.y = Math.max(12, Math.min(canvas.height - 12, this.y));
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    // health bar (rhino max 85)
    drawHealthBar(0, -36, this.hp, 85);

    // stronger ground shadow with soft feather
    const shadowGrad = ctx.createRadialGradient(0, 12, 6, 0, 18, 36);
    shadowGrad.addColorStop(0, "rgba(0,0,0,0.35)");
    shadowGrad.addColorStop(1, "rgba(0,0,0,0.06)");
    ctx.fillStyle = shadowGrad;
    ctx.beginPath();
    ctx.ellipse(0, 14, 16, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // main body with layered gradients to suggest mass and leathery skin
    const bodyGrad = ctx.createLinearGradient(0, -12, 0, 18);
    bodyGrad.addColorStop(0, "#7f7772");
    bodyGrad.addColorStop(0.5, "#6d6360");
    bodyGrad.addColorStop(1, "#4e4744");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    // shape with a subtle belly curve
    ctx.moveTo(-16, 6);
    ctx.quadraticCurveTo(-14, -10, -12, -12);
    ctx.lineTo(12, -12);
    ctx.quadraticCurveTo(14, -10, 16, 6);
    ctx.quadraticCurveTo(6, 14, -6, 14);
    ctx.closePath();
    ctx.fill();

    // body contour and heavy edge for silhouette
    ctx.strokeStyle = "rgba(35,30,28,0.95)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-16, 6);
    ctx.quadraticCurveTo(-14, -10, -12, -12);
    ctx.lineTo(12, -12);
    ctx.quadraticCurveTo(14, -10, 16, 6);
    ctx.quadraticCurveTo(6, 14, -6, 14);
    ctx.closePath();
    ctx.stroke();

    // layered skin folds and highlights
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let i = -8; i <= 8; i += 4) {
      ctx.beginPath();
      ctx.moveTo(-10 + i * 0.1, -2 + (i * 0.12));
      ctx.quadraticCurveTo(0, 2 + (i * 0.06), 10 - i * 0.1, 6 + (i * 0.08));
      ctx.stroke();
    }

    // rough skin texture: subtle speckles and scuffs
    ctx.fillStyle = "rgba(0,0,0,0.06)";
    for (let i = 0; i < 28; i++) {
      const rx = rand(-14, 14);
      const ry = rand(-6, 8);
      ctx.beginPath();
      ctx.ellipse(rx, ry, rand(0.5, 1.8), rand(0.4, 1.2), rand(-0.6, 0.6), 0, Math.PI * 2);
      ctx.fill();
    }

    // head with stronger form and neck plates
    const headGrad = ctx.createLinearGradient(0, -24, 0, -6);
    headGrad.addColorStop(0, "#8a7f79");
    headGrad.addColorStop(1, "#645e5a");
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.roundRect(-12, -26, 24, 18, 6);
    ctx.fill();

    ctx.strokeStyle = "rgba(35,30,28,0.95)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(-12, -26, 24, 18, 6);
    ctx.stroke();

    // pronounced neck fold
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-8, -8);
    ctx.quadraticCurveTo(0, -3, 8, -8);
    ctx.stroke();

    // horn: textured, layered gradient with cracks and specular
    const hornGrad = ctx.createLinearGradient(2, -30, 8, -12);
    hornGrad.addColorStop(0, "#fff8f0");
    hornGrad.addColorStop(0.45, "#e6dbc8");
    hornGrad.addColorStop(1, "#bdb2a4");

    // big horn base shape
    ctx.fillStyle = hornGrad;
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(6, -34);
    ctx.lineTo(2, -22);
    ctx.closePath();
    ctx.fill();

    // horn cracks / striations
    ctx.strokeStyle = "rgba(80,70,60,0.45)";
    ctx.lineWidth = 0.9;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      const sx = 1 + i * 1.2;
      ctx.moveTo(sx, -25 + i * 2);
      ctx.quadraticCurveTo(4 + i * 0.6, -28 + i * 1.5, 2 + i * 0.3, -30 + i * 1.2);
      ctx.stroke();
    }

    // specular sheen on horn tip
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(3.2, -25);
    ctx.lineTo(5.5, -31);
    ctx.stroke();

    // smaller horn with its own detail
    ctx.fillStyle = "#e6ded4";
    ctx.beginPath();
    ctx.moveTo(-4, -21);
    ctx.lineTo(-1, -28);
    ctx.lineTo(-3, -20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(70,60,55,0.6)";
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // ears with inner shading
    ctx.fillStyle = "#5a524d";
    ctx.beginPath();
    ctx.roundRect(-11, -25, 4, 6, 2);
    ctx.roundRect(7, -25, 4, 6, 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // expressive eyes with small highlight and darker lid
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(-4, -16, 2.2, 2.6, 0.1, 0, Math.PI * 2);
    ctx.ellipse(4, -16, 2.2, 2.6, -0.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#1a1110";
    ctx.beginPath();
    ctx.arc(-4, -15.6, 1, 0, Math.PI * 2);
    ctx.arc(4, -15.6, 1, 0, Math.PI * 2);
    ctx.fill();

    // subtle eyelids / brows for mood
    ctx.strokeStyle = "rgba(0,0,0,0.32)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-6, -17.5);
    ctx.quadraticCurveTo(-4, -18.6, -2, -17.6);
    ctx.moveTo(6, -17.5);
    ctx.quadraticCurveTo(4, -18.6, 2, -17.6);
    ctx.stroke();

    // pronounced scar and battle marks on face
    ctx.strokeStyle = "rgba(0,0,0,0.38)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-9, -14);
    ctx.lineTo(-5, -11);
    ctx.lineTo(-3, -12);
    ctx.stroke();

    // strong legs with joint shading and toe definition
    ctx.fillStyle = "#5a524d";
    // front left
    ctx.beginPath();
    ctx.roundRect(-14, 6, 7, 10, 3);
    ctx.fill();
    // front right
    ctx.beginPath();
    ctx.roundRect(-4, 6, 7, 10, 3);
    ctx.fill();
    // back left
    ctx.beginPath();
    ctx.roundRect(6, 6, 7, 10, 3);
    ctx.fill();
    // back right
    ctx.beginPath();
    ctx.roundRect(13, 6, 7, 10, 3);
    ctx.fill();

    // toe accents
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 0.9;
    for (const tx of [-11, -3, 8, 15]) {
      ctx.beginPath();
      ctx.moveTo(tx - 2, 14);
      ctx.lineTo(tx + 4, 14);
      ctx.stroke();
    }

    // subtle reflective edge along back to sell form
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-12, -6);
    ctx.quadraticCurveTo(0, -12, 12, -6);
    ctx.stroke();

    ctx.restore();
  }
}

class Alien {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.hp = 345;
    this.speed = 2.1;
    this.state = "observe"; // observe, hunt, kite, flank, retreat, mine
    this.target = null;
    this.retargetCooldown = 0;

    // armas e armaduras próprias, baseadas em minérios
    this.weapon = 2.4;
    this.weaponType = "none";
    this.armorLevel = 0; // 0=sem, 1=leve, 2=média, 3=pesada

    // profissão do alien: alguns são mineradores especializados
    this.role = Math.random() < 0.6 ? "miner" : "guardian";
  }

  update() {
    // IA de movimento dos Aliens: eles analisam ameaças, coletam minérios e se reposicionam pelo mapa
    // Aliens coletam minérios para melhorar armas e armaduras
    resources.forEach((r, i) => {
      if (dist(this, r) < 15) {
        const power = resourcePower[r.type] || 1;
        if (power >= this.weapon) {
          this.weapon = power;
          this.weaponType = r.type;
        }
        resources.splice(i, 1);
      }
    });

    // definir nível de armadura baseado no minério que está usando
    if (this.weapon >= (resourcePower.ruby || 10)) this.armorLevel = 3;
    else if (this.weapon >= (resourcePower.diamond || 8)) this.armorLevel = 3;
    else if (this.weapon >= (resourcePower.gold || 5)) this.armorLevel = 2;
    else if (this.weapon >= (resourcePower.iron || 4)) this.armorLevel = 1;
    else this.armorLevel = 0;

    // alvo de recurso mais próximo (para mineradores)
    const nearestResource = findNearest(this, resources);

    // dano em curto alcance APENAS contra monstros e rinocerontes (neutros com humanos/GEFs)
    const combatTargets = [...monsters, ...rhinos];
    for (let i = combatTargets.length - 1; i >= 0; i--) {
      const t = combatTargets[i];
      if (dist(this, t) < 24) {
        t.hp -= this.weapon;
        if (t.hp <= 0) {
          if (t instanceof Monster) {
            const idx = monsters.indexOf(t);
            if (idx !== -1) monsters.splice(idx, 1);
          } else if (t instanceof Rhino) {
            const idx = rhinos.indexOf(t);
            if (idx !== -1) rhinos.splice(idx, 1);
          }
        }
      }
    }

    // escolher novo alvo de forma "inteligente" periodicamente
    if (!this.target || this.retargetCooldown <= 0 || this._isTargetDead(this.target)) {
      // aliens são neutros: só escolhem alvos que são monstros ou rinocerontes
      this.target = this.chooseBestTarget();
      this.retargetCooldown = 60;
    } else {
      this.retargetCooldown--;
    }

    // contar vizinhança para decidir estado
    const nearbyHumans = humans.filter((h) => dist(this, h) < 110).length;
    const nearbyRhinos = rhinos.filter((r) => dist(this, r) < 120).length;

    if (this.hp < 80 || nearbyHumans + nearbyRhinos >= 6) {
      this.state = "retreat";
    } else if (this.role === "miner" && nearestResource && !this.target) {
      // mineradores priorizam ir minerar quando não há combate importante
      this.state = "mine";
    } else if (this.target && nearbyRhinos > 0) {
      this.state = "kite";
    } else if (this.target && nearbyHumans >= 3) {
      this.state = "flank";
    } else if (this.target) {
      this.state = "hunt";
    } else if (this.role === "miner" && nearestResource) {
      this.state = "mine";
    } else {
      this.state = "observe";
    }

    let dirX = 0;
    let dirY = 0;
    let speed = this.speed;

    if (this.state === "hunt" && this.target) {
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      dirX += dx / d;
      dirY += dy / d;
    } else if (this.state === "mine" && nearestResource) {
      // movimento focado em ir até o minério mais próximo
      const dx = nearestResource.x - this.x;
      const dy = nearestResource.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      dirX += dx / d;
      dirY += dy / d;
      speed *= 1.05;
    } else if (this.state === "kite" && this.target) {
      // mantém distância média do alvo perigoso, atacando de longe
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const desired = 90;
      if (d < desired) {
        dirX -= dx / d;
        dirY -= dy / d;
      } else if (d > desired + 30) {
        dirX += dx / d;
        dirY += dy / d;
      }
      speed *= 1.1;
    } else if (this.state === "flank" && this.target) {
      // em vez de ir direto, vai para um lado do alvo
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d;
      const ny = dy / d;
      // vetor lateral
      const side = Math.random() < 0.5 ? 1 : -1;
      const lx = -ny * side;
      const ly = nx * side;
      dirX += nx * 0.4 + lx * 0.8;
      dirY += ny * 0.4 + ly * 0.8;
      speed *= 1.3;
    } else if (this.state === "retreat") {
      // foge do centro dos inimigos próximos
      let cx = 0;
      let cy = 0;
      let count = 0;
      const threats = [...humans, ...rhinos, ...monsters];
      for (const t of threats) {
        if (dist(this, t) < 150) {
          cx += t.x;
          cy += t.y;
          count++;
        }
      }
      if (count > 0) {
        cx /= count;
        cy /= count;
        const dx = this.x - cx;
        const dy = this.y - cy;
        const d = Math.hypot(dx, dy) || 1;
        dirX += dx / d;
        dirY += dy / d;
        speed *= 1.4;
      }
    } else {
      // observe: se aproxima vagarosamente do maior "aglomerado" de unidades
      let cx = 0;
      let cy = 0;
      let count = 0;
      const crowd = [...humans, ...gefs, ...monsters, ...rhinos];
      for (const t of crowd) {
        cx += t.x;
        cy += t.y;
        count++;
      }
      if (count > 0) {
        cx /= count;
        cy /= count;
        const dx = cx - this.x;
        const dy = cy - this.y;
        const d = Math.hypot(dx, dy) || 1;
        dirX += dx / d;
        dirY += dy / d;
        speed *= 0.9;
      }
      // mesmo observando, mineradores ainda têm leve tendência a andar em direção a minérios
      if (this.role === "miner" && nearestResource) {
        const dxR = nearestResource.x - this.x;
        const dyR = nearestResource.y - this.y;
        const dR = Math.hypot(dxR, dyR) || 1;
        dirX += (dxR / dR) * 0.5;
        dirY += (dyR / dR) * 0.5;
      }
    }

    // ruído mínimo para não ficar robótico
    dirX += rand(-0.08, 0.08);
    dirY += rand(-0.08, 0.08);

    const len = Math.hypot(dirX, dirY) || 1;
    this.x += (dirX / len) * speed;
    this.y += (dirY / len) * speed;

    // limites de tela
    this.x = Math.max(12, Math.min(canvas.width - 12, this.x));
    this.y = Math.max(12, Math.min(canvas.height - 12, this.y));
  }

  _isTargetDead(t) {
    if (!t) return true;
    return t.hp <= 0;
  }

  chooseBestTarget() {
    // neutro: não mira em humanos nem em GEFs, só em monstros e rinocerontes
    const scored = [];
    const pushTargets = (list, baseScore) => {
      for (const t of list) {
        const d = dist(this, t);
        const score = baseScore - d * 0.1; // quanto mais perto, melhor
        scored.push({ t, score });
      }
    };
    pushTargets(rhinos, 30);
    pushTargets(monsters, 25);

    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    return scored[0].t;
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    // health bar (alien max 345)
    drawHealthBar(0, -30, this.hp, 345);

    // profession label
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.font = "10px Arial";
    ctx.textAlign = "center";
    const label = this.role === "miner" ? "Minerador" : "Alien";
    ctx.fillText(label, 0, -30);

    // soft hovering shadow
    ctx.fillStyle = "rgba(0,0,0,0.44)";
    ctx.beginPath();
    ctx.ellipse(0, 14, 14, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // animated parameters
    const t = (Date.now() % 2000) / 2000;
    const pulse = 0.9 + Math.sin(t * Math.PI * 2) * 0.12;

    // improved body: translucent layered skin with subtle veins and bioluminescent spots
    const base = this.role === "miner" ? "#88ffd8" : "#57ffb3";
    const bodyGrad = ctx.createRadialGradient(0, -4, 3, 0, 0, 20);
    bodyGrad.addColorStop(0, lightenColor(base, 0.55));
    bodyGrad.addColorStop(0.35, lightenColor(base, 0.18));
    bodyGrad.addColorStop(0.7, base);
    bodyGrad.addColorStop(1, darkenColor(base, 0.28));

    // soft subsurface glow
    withGlow("rgba(100,255,200,0.28)", 28, () => {
      ctx.beginPath();
      ctx.ellipse(0, -2, 14 * pulse, 18 * pulse, 0, 0, Math.PI * 2);
      ctx.fillStyle = bodyGrad;
      ctx.fill();
    });

    // main translucent shell
    ctx.globalAlpha = 0.98;
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, -2, 11 * pulse, 14 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();

    // subtle skin veins / markings (static lines for texture)
    ctx.strokeStyle = "rgba(20,80,60,0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const offX = -6 + i * 4;
      ctx.beginPath();
      ctx.moveTo(offX, -10);
      ctx.bezierCurveTo(offX + 8, -6, offX + 2, 6, offX, 10);
      ctx.stroke();
    }

    // bioluminescent spots that pulse
    const spots = [
      { x: -6, y: -2, s: 1.6 },
      { x: 6, y: 0, s: 1.3 },
      { x: -2, y: 4, s: 1.1 },
      { x: 3, y: -6, s: 1.4 },
    ];
    spots.forEach((sp, i) => {
      const glowCol = ["rgba(160,255,235,0.95)", "rgba(120,240,255,0.95)","rgba(200,255,200,0.95)","rgba(255,180,230,0.95)"][i % 4];
      const g = ctx.createRadialGradient(sp.x, sp.y - 2, 0, sp.x, sp.y - 2, 12 * (0.7 + 0.3 * Math.sin(t * Math.PI * 2 + i)));
      g.addColorStop(0, glowCol);
      g.addColorStop(1, "rgba(255,255,255,0)");
      withGlow(glowCol, 14 + i * 2, () => {
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 4 * sp.s * (0.9 + 0.15 * Math.sin(t * Math.PI * 2 + i)), 0, Math.PI * 2);
        ctx.fill();
      });
      // center dot
      ctx.fillStyle = lightenColor("#bfffe6", 0.12);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 1.1 * sp.s, 0, Math.PI * 2);
      ctx.fill();
    });

    // reflective rim and translucency
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, -2, 11.4 * pulse, 14.4 * pulse, -0.05, 0, Math.PI * 2);
    ctx.stroke();

    // dynamic lower ring (energy) with animated wobble
    const ringGrad = ctx.createLinearGradient(-12, 0, 12, 0);
    ringGrad.addColorStop(0, "rgba(140,255,220,0.0)");
    ringGrad.addColorStop(0.45, "rgba(160,255,235,0.85)");
    ringGrad.addColorStop(1, "rgba(140,255,220,0.0)");
    ctx.strokeStyle = ringGrad;
    ctx.lineWidth = 3 + Math.sin(t * Math.PI * 2) * 0.6;
    ctx.beginPath();
    ctx.ellipse(0, 0 + Math.sin(t * Math.PI * 2) * 0.6, 12 + Math.sin(t * Math.PI * 2) * 0.8, 4 + Math.cos(t * Math.PI * 2) * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();

    // head dome with layered translucency and inner skull hint
    const headGrad = ctx.createRadialGradient(0, -18, 2, 0, -18, 18);
    headGrad.addColorStop(0, "rgba(255,255,255,0.95)");
    headGrad.addColorStop(0.25, lightenColor(base, 0.35));
    headGrad.addColorStop(0.7, base);
    headGrad.addColorStop(1, darkenColor(base, 0.22));
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.ellipse(0, -18, 12, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // subtle inner skull shadow for depth
    ctx.fillStyle = "rgba(10,40,30,0.08)";
    ctx.beginPath();
    ctx.ellipse(0, -18, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // expressive glossy eyes
    ctx.fillStyle = "#080808";
    ctx.beginPath();
    ctx.ellipse(-5, -18, 3.6, 4.6, 0.12, 0, Math.PI * 2);
    ctx.ellipse(5, -18, 3.6, 4.6, -0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.arc(-6.2, -19.5, 1.1, 0, Math.PI * 2);
    ctx.arc(4.2, -20, 0.9, 0, Math.PI * 2);
    ctx.fill();

    // thin limb hints (more organic tentacles that sway)
    ctx.strokeStyle = "rgba(90,200,160,0.9)";
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      const sx = i * 6;
      const phase = t * Math.PI * 2 + i;
      ctx.beginPath();
      ctx.moveTo(sx, 2);
      ctx.quadraticCurveTo(sx + Math.sin(phase) * 6, 8 + Math.cos(phase) * 6, sx + Math.sin(phase * 1.3) * 10, 16);
      ctx.stroke();

      // small glowing tip
      withGlow("rgba(140,255,220,0.9)", 12, () => {
        ctx.fillStyle = "rgba(180,255,230,0.95)";
        ctx.beginPath();
        const tipX = sx + Math.sin(phase * 1.3) * 10;
        const tipY = 16;
        ctx.arc(tipX, tipY, 2.2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // weapon energy blade (if any)
    if (this.weaponType !== "none") {
      let bladeColor = "#ffffff";
      if (this.weaponType === "wood") bladeColor = "#8b5a2b";
      else if (this.weaponType === "stone") bladeColor = "#b0b0b0";
      else if (this.weaponType === "iron") bladeColor = "#b7bcc5";
      else if (this.weaponType === "gold") bladeColor = "#ffd94a";
      else if (this.weaponType === "diamond") bladeColor = "#88f0ff";
      else if (this.weaponType === "ruby") bladeColor = "#e0253c";
      else if (this.weaponType === "copper") bladeColor = "#c46b3a";
      else if (this.weaponType === "lapis") bladeColor = "#2354b8";
      else if (this.weaponType === "sapphire") bladeColor = "#1e7be5";
      else if (this.weaponType === "netherite") bladeColor = "#2d2625";
      else if (this.weaponType === "amandita") bladeColor = "#ff66c4";

      const bladeGrad = ctx.createLinearGradient(10, -6, 16, -12);
      bladeGrad.addColorStop(0, lightenColor(bladeColor, 0.3));
      bladeGrad.addColorStop(1, darkenColor(bladeColor, 0.3));

      // handle
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(9, 4);
      ctx.lineTo(11, -2);
      ctx.stroke();

      // luminous blade with stronger glow
      withGlow(lightenColor(bladeColor, 0.7), 18, () => {
        ctx.beginPath();
        ctx.moveTo(11, -2);
        ctx.lineTo(16, -10);
        ctx.lineWidth = 8;
        ctx.strokeStyle = bladeGrad;
        ctx.stroke();
      });

      ctx.strokeStyle = bladeGrad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(11, -2);
      ctx.lineTo(16, -10);
      ctx.stroke();
    }

    // tiny orbiting particles for flair (two layers)
    for (let layer = 0; layer < 2; layer++) {
      const count = 3 + layer;
      for (let i = 0; i < count; i++) {
        const ang = (Math.PI * 2 * i) / count + t * (0.6 + layer * 0.3);
        const rr = 16 + layer * 6;
        const px = Math.cos(ang) * rr;
        const py = Math.sin(ang) * (rr * 0.25) - 6;
        ctx.fillStyle = layer === 0 ? "rgba(170,255,235,0.9)" : "rgba(200,255,200,0.6)";
        ctx.beginPath();
        ctx.arc(px, py, 1.2 + layer * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

class Gef {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.hp = 100;
    this.speed = 1.3;
    this.buildCooldown = 0;
  }

  update() {
    // reduzir cooldown de construção
    if (this.buildCooldown > 0) {
      this.buildCooldown--;
    }

    // atacar monstros próximos
    monsters.forEach((m, i) => {
      if (dist(this, m) < 25) {
        m.hp -= 1.2;
        if (m.hp <= 0) monsters.splice(i, 1);
      }
    });

    // atacar rinocerontes próximos (GEF ajuda a segurar o rinoceronte)
    rhinos.forEach((r, i) => {
      if (dist(this, r) < 28) {
        r.hp -= 1.8;
        if (r.hp <= 0) rhinos.splice(i, 1);
      }
    });

    // buscar humano e ameaças mais próximas
    const nearestHuman = findNearest(this, humans);
    const nearestRhino = findNearest(this, rhinos);
    const nearestMonster = findNearest(this, monsters);

    let dirX = 0;
    let dirY = 0;

    // comportamento defensivo/ofensivo mais inteligente
    const threatCandidates = [];
    if (nearestRhino) threatCandidates.push(nearestRhino);
    if (nearestMonster) threatCandidates.push(nearestMonster);
    const nearestThreat = threatCandidates.length
      ? threatCandidates.reduce((best, t) =>
          dist(this, t) < dist(this, best) ? t : best
        )
      : null;

    if (nearestHuman) {
      const dxH = nearestHuman.x - this.x;
      const dyH = nearestHuman.y - this.y;
      const distToHuman = Math.hypot(dxH, dyH) || 1;

      // manter-se relativamente perto dos humanos
      if (distToHuman > 70) {
        dirX += (dxH / distToHuman) * 1.1;
        dirY += (dyH / distToHuman) * 1.1;
      }

      // se existir ameaça, posicionar-se como "escudo" entre humano e ameaça
      if (nearestThreat) {
        const midX = (nearestHuman.x + nearestThreat.x) / 2;
        const midY = (nearestHuman.y + nearestThreat.y) / 2;
        const dxM = midX - this.x;
        const dyM = midY - this.y;
        const distToMid = Math.hypot(dxM, dyM) || 1;
        dirX += (dxM / distToMid) * 1.3;
        dirY += (dyM / distToMid) * 1.3;
      }

      // se estiver bem próximo do humano, tentar construir estruturas
      if (distToHuman <= 60 && this.buildCooldown === 0) {
        this.tryBuildHouseNear(nearestHuman);
        this.tryBuildMarketNear(nearestHuman);
        this.buildCooldown = 240; // ~4 segundos a 60fps, ~8s a 30fps (depende do monitor)
      }
    } else if (nearestThreat) {
      // sem humano por perto: GEF ainda tenta controlar a ameaça
      const dxT = nearestThreat.x - this.x;
      const dyT = nearestThreat.y - this.y;
      const distToThreat = Math.hypot(dxT, dyT) || 1;

      // se com muita vida, aproxima mais; se estiver fraco, se afasta
      if (this.hp > 60) {
        dirX += dxT / distToThreat;
        dirY += dyT / distToThreat;
      } else {
        dirX -= (dxT / distToThreat) * 1.3;
        dirY -= (dyT / distToThreat) * 1.3;
      }
    }

    // leve ruído para o movimento, mas menos caótico
    dirX += rand(-0.12, 0.12);
    dirY += rand(-0.12, 0.12);

    const len = Math.hypot(dirX, dirY) || 1;
    this.x += (dirX / len) * this.speed;
    this.y += (dirY / len) * this.speed;

    // mantém dentro da tela
    this.x = Math.max(10, Math.min(canvas.width - 10, this.x));
    this.y = Math.max(10, Math.min(canvas.height - 10, this.y));
  }

  tryBuildHouseNear(human) {
    // limitar casas para no máximo a quantidade de humanos
    if (houses.length >= humans.length) return;

    // tenta construir casas em linha reta para a direita do humano
    const spacing = 40;
    const maxHousesInLine = 8;

    for (let i = 1; i <= maxHousesInLine; i++) {
      const hx = human.x + i * spacing;
      const hy = human.y;

      // dentro do mapa
      if (hx < 20 || hy < 20 || hx > canvas.width - 20 || hy > canvas.height - 20) continue;

      // não muito em cima de outra casa
      let tooClose = false;
      for (const house of houses) {
        if (Math.hypot(house.x - hx, house.y - hy) < 40) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      houses.push(new House(hx, hy));
      // ao criar casa nova, chance de já ter um animal
      spawnHouseAnimal(hx, hy);
      break;
    }
  }

  tryBuildMarketNear(human) {
    // só constrói mercado para donos de mercado
    if (human.role !== "marketOwner") return;

    // número alvo de mercados = número de donos de mercado
    const marketOwners = humans.filter((h) => h.role === "marketOwner").length;
    if (markets.length >= marketOwners) return;

    const spacing = 45;

    for (let i = 1; i <= 4; i++) {
      const angle = (Math.PI / 2) * i;
      const mx = human.x + Math.cos(angle) * spacing;
      const my = human.y + Math.sin(angle) * spacing;

      if (mx < 30 || my < 30 || mx > canvas.width - 30 || my > canvas.height - 30)
        continue;

      // evitar ficar em cima de outras construções
      let tooClose = false;
      for (const house of houses) {
        if (Math.hypot(house.x - mx, house.y - my) < 40) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        for (const market of markets) {
          if (Math.hypot(market.x - mx, market.y - my) < 50) {
            tooClose = true;
            break;
          }
        }
      }
      if (tooClose) continue;

      markets.push(new Market(mx, my));
      break;
    }
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    // health bar (GEF max 100)
    drawHealthBar(0, -40, this.hp, 100);

    // soft shadow
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.ellipse(0, 14, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // pulsing timer for subtle animation
    const t = (Date.now() % 1000) / 1000;
    const pulse = 0.9 + Math.sin(t * Math.PI * 2) * 0.08;

    // energy halo under the GEF
    withGlow("rgba(160,230,255,0.22)", 22, () => {
      ctx.fillStyle = `rgba(150,220,255,${0.08 * pulse})`;
      ctx.beginPath();
      ctx.ellipse(0, 8, 22 * pulse, 8 * pulse, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // body gradient (multilayered)
    const bodyOuterGrad = ctx.createLinearGradient(0, -12, 0, 12);
    bodyOuterGrad.addColorStop(0, "#ffeccf");
    bodyOuterGrad.addColorStop(0.4, "#ffd7a8");
    bodyOuterGrad.addColorStop(1, "#e2b889");

    const bodyInnerGrad = ctx.createRadialGradient(0, -6, 2, 0, -2, 18);
    bodyInnerGrad.addColorStop(0, "rgba(255,255,255,0.95)");
    bodyInnerGrad.addColorStop(0.25, "rgba(255,240,210,0.9)");
    bodyInnerGrad.addColorStop(0.7, "rgba(230,200,160,0.8)");
    bodyInnerGrad.addColorStop(1, "rgba(180,140,100,0.6)");

    // outer shell
    ctx.fillStyle = bodyOuterGrad;
    ctx.beginPath();
    ctx.roundRect(-16, -26, 32, 36, 10);
    ctx.fill();

    // inner luminous torso
    withGlow("rgba(255,200,120,0.32)", 26, () => {
      ctx.fillStyle = bodyInnerGrad;
      ctx.beginPath();
      ctx.roundRect(-12, -22, 24, 30, 8);
      ctx.fill();
    });

    // chest core (pulsing)
    const coreRadius = 5 * pulse;
    const coreGrad = ctx.createRadialGradient(0, -6, 1, 0, -6, 18);
    coreGrad.addColorStop(0, "rgba(255,255,255,1)");
    coreGrad.addColorStop(0.2, "rgba(255,220,140,0.95)");
    coreGrad.addColorStop(0.6, "rgba(255,150,60,0.7)");
    coreGrad.addColorStop(1, "rgba(255,100,30,0.08)");
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.ellipse(0, -6, coreRadius * 2.8, coreRadius * 1.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // delicate filaments/arcs around chest
    ctx.strokeStyle = `rgba(255,200,120,${0.65 * pulse})`;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) {
      const ang = i * (Math.PI / 2) + t * 0.8;
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * 6, -6 + Math.sin(ang) * 2, 8 + i, Math.PI * 0.2, Math.PI * 0.9);
      ctx.stroke();
    }

    // head dome with subtle rim highlight
    const domeGrad = ctx.createRadialGradient(0, -28, 3, 0, -26, 26);
    domeGrad.addColorStop(0, "rgba(255,245,230,0.98)");
    domeGrad.addColorStop(0.35, "#fff0d6");
    domeGrad.addColorStop(1, "#d9b58a");
    ctx.fillStyle = domeGrad;
    ctx.beginPath();
    ctx.ellipse(0, -28, 18, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    // glassy rim
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -28, 18, 12, 0, 0, Math.PI * 2);
    ctx.stroke();

    // expressive eyes with sheen
    const eyeY = -30;
    ctx.fillStyle = "#0b0b0b";
    ctx.beginPath();
    ctx.ellipse(-6, eyeY, 3.6, 5.2, 0.2, 0, Math.PI * 2);
    ctx.ellipse(6, eyeY, 3.6, 5.2, -0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(-7, eyeY - 2, 1.1, 0, Math.PI * 2);
    ctx.arc(5, eyeY - 3, 0.9, 0, Math.PI * 2);
    ctx.fill();

    // small mouth / expression line
    ctx.strokeStyle = "rgba(80,40,20,0.85)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-4, -22);
    ctx.quadraticCurveTo(0, -20 + Math.sin(t * Math.PI * 2) * 0.5, 4, -22);
    ctx.stroke();

    // antenna with pulsing orb
    ctx.strokeStyle = "rgba(120,80,40,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.lineTo(0, -44);
    ctx.stroke();

    const orbPulse = 0.6 + Math.sin(t * Math.PI * 2) * 0.25;
    withGlow("rgba(255,190,80,0.6)", 18, () => {
      ctx.fillStyle = `rgba(255,200,110,${0.9 * pulse})`;
      ctx.beginPath();
      ctx.arc(0, -48, 4 * orbPulse, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = "#ffd489";
    ctx.beginPath();
    ctx.arc(0, -48, 3 * orbPulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,230,180,0.6)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(0, -48, 3.6 * orbPulse, 0, Math.PI * 2);
    ctx.stroke();

    // back plating details
    ctx.strokeStyle = "rgba(100,60,30,0.25)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.roundRect(-8 + i * 6, -12 + i * 4, 6, 16 - i * 4, 2);
      ctx.stroke();
    }

    // subtle highlight strokes
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-12, -6);
    ctx.lineTo(-4, -14);
    ctx.moveTo(12, -6);
    ctx.lineTo(4, -14);
    ctx.stroke();

    // restore
    ctx.restore();
  }
}

/* Golem de Ferro: protege humanos e ataca monstros e rinocerontes */
class Golem {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.hp = 100;
    this.speed = 1.2;
    this.attack = 3.6;
    this.target = null; // current hostile target (monster or rhino)
    this.protectTarget = null; // human to protect
    this.wanderSeed = Math.random() * 1000;
  }

  update() {
    // refresh protect target
    if (!this.protectTarget || humans.indexOf(this.protectTarget) === -1) {
      this.protectTarget = findNearest(this, humans);
    }

    // choose nearest hostile (monsters or rhinos)
    const hostiles = [...monsters, ...rhinos];
    this.target = findNearest(this, hostiles);

    let dirX = 0;
    let dirY = 0;

    // if protecting a human, try to position between human and threat
    if (this.protectTarget) {
      const dxH = this.protectTarget.x - this.x;
      const dyH = this.protectTarget.y - this.y;
      const dH = Math.hypot(dxH, dyH) || 1;
      if (dH > 60 && !this.target) {
        dirX += dxH / dH;
        dirY += dyH / dH;
      }
      if (this.target) {
        const midX = (this.protectTarget.x + this.target.x) / 2;
        const midY = (this.protectTarget.y + this.target.y) / 2;
        const dx = midX - this.x;
        const dy = midY - this.y;
        const d = Math.hypot(dx, dy) || 1;
        dirX += (dx / d) * 1.4;
        dirY += (dy / d) * 1.4;
      }
    }

    // if no protect target but hostile exists, approach hostile
    if (!this.protectTarget && this.target) {
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      dirX += dx / d;
      dirY += dy / d;
    }

    // small wander when idle
    if (!this.protectTarget && !this.target) {
      this.wanderSeed += 0.02;
      dirX += Math.cos(this.wanderSeed) * 0.6;
      dirY += Math.sin(this.wanderSeed) * 0.6;
    }

    // avoid water edges
    const repel = waterRepelVector(this.x, this.y);
    if (repel.m > 0) {
      const weight = isWaterAt(this.x, this.y) ? 2.0 : 1.2 + repel.m * 0.6;
      dirX += repel.x * repel.m * weight;
      dirY += repel.y * repel.m * weight;
    }

    // apply movement
    const len = Math.hypot(dirX, dirY) || 1;
    this.x += (dirX / len) * this.speed;
    this.y += (dirY / len) * this.speed;

    // melee attack hostiles in range
    if (this.target) {
      for (let i = hostiles.length - 1; i >= 0; i--) {
        const t = hostiles[i];
        if (dist(this, t) < 28) {
          t.hp -= this.attack;
          if (t.hp <= 0) {
            if (t instanceof Monster) {
              const idx = monsters.indexOf(t);
              if (idx !== -1) monsters.splice(idx, 1);
            } else if (t instanceof Rhino) {
              const idx = rhinos.indexOf(t);
              if (idx !== -1) rhinos.splice(idx, 1);
            }
          }
        }
      }
    }

    // bounds
    this.x = Math.max(12, Math.min(canvas.width - 12, this.x));
    this.y = Math.max(12, Math.min(canvas.height - 12, this.y));
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    // health bar (golem max 100)
    drawHealthBar(0, -66, this.hp, 100);

    // stronger elliptical shadow to ground
    const shadowGrad = ctx.createRadialGradient(0, 18, 8, 0, 18, 38);
    shadowGrad.addColorStop(0, "rgba(0,0,0,0.45)");
    shadowGrad.addColorStop(1, "rgba(0,0,0,0.05)");
    ctx.fillStyle = shadowGrad;
    ctx.beginPath();
    ctx.ellipse(0, 18, 22, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // torso: taller, more humanoid proportions (broad shoulders, narrow waist)
    const torsoGrad = ctx.createLinearGradient(0, -36, 0, 28);
    torsoGrad.addColorStop(0, "#e9eef1");
    torsoGrad.addColorStop(0.45, "#c7ccd1");
    torsoGrad.addColorStop(1, "#757b80");
    ctx.fillStyle = torsoGrad;
    ctx.beginPath();
    // shoulders
    ctx.moveTo(-28, -22);
    ctx.quadraticCurveTo(-22, -40, -6, -44);
    ctx.lineTo(6, -44);
    ctx.quadraticCurveTo(22, -40, 28, -22);
    // waist curve
    ctx.lineTo(20, 18);
    ctx.quadraticCurveTo(0, 30, -20, 18);
    ctx.closePath();
    ctx.fill();

    // subtle plating lines
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-16, -8);
    ctx.lineTo(16, -8);
    ctx.moveTo(-10, 6);
    ctx.lineTo(10, 6);
    ctx.stroke();

    // chest core: reinforced glowing core (smaller, cooler)
    withGlow("rgba(170,200,240,0.18)", 18, () => {
      const coreGrad = ctx.createRadialGradient(0, -6, 1, 0, -6, 18);
      coreGrad.addColorStop(0, "rgba(220,235,255,1)");
      coreGrad.addColorStop(0.35, "rgba(200,220,240,0.9)");
      coreGrad.addColorStop(1, "rgba(120,140,170,0.05)");
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.roundRect(-7, -12, 14, 10, 3);
      ctx.fill();
    });

    // sternum plate highlight
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-6, -6);
    ctx.lineTo(0, -12);
    ctx.lineTo(6, -6);
    ctx.stroke();

    // head: more humanoid helmet shape, narrower and angular
    ctx.fillStyle = darkenColor("#9aa1a6", 0.06);
    ctx.beginPath();
    ctx.roundRect(-9, -56, 18, 14, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.26)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-9, -56, 18, 14, 4);
    ctx.stroke();

    // visor / eye slit
    withGlow("rgba(170,210,255,0.9)", 12, () => {
      ctx.fillStyle = "rgba(140,190,230,0.98)";
      ctx.beginPath();
      ctx.roundRect(-7, -52, 14, 4, 2);
      ctx.fill();
    });
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(-7, -52, 14, 4);

    // shoulders / pauldrons: pronounced armor plates
    ctx.fillStyle = "#7e8589";
    ctx.beginPath();
    ctx.roundRect(-30, -26, 12, 18, 4);
    ctx.roundRect(18, -26, 12, 18, 4);
    ctx.fill();

    // upper arms: muscular plated arms with joint detail
    ctx.fillStyle = "#8b9196";
    ctx.beginPath();
    ctx.roundRect(-34, -6, 12, 28, 4); // left upper
    ctx.roundRect(22, -6, 12, 28, 4); // right upper
    ctx.fill();

    // forearms: stronger, tapered with riveted bands
    ctx.fillStyle = "#7a8084";
    ctx.beginPath();
    ctx.roundRect(-36, 20, 14, 12, 3); // left wrist/gauntlet
    ctx.roundRect(20, 20, 14, 12, 3); // right wrist/gauntlet
    ctx.fill();

    // hands: chunkier fists
    ctx.fillStyle = "#666b6f";
    ctx.beginPath();
    ctx.roundRect(-40, 28, 16, 10, 3);
    ctx.roundRect(24, 28, 16, 10, 3);
    ctx.fill();

    // groin/hip reinforcement plate
    ctx.fillStyle = "#6f7579";
    ctx.beginPath();
    ctx.roundRect(-18, 16, 36, 10, 3);
    ctx.fill();

    // legs: strong humanoid legs with plated knees and shin guards
    // left leg
    ctx.fillStyle = "#80878b";
    ctx.beginPath();
    ctx.moveTo(-14, 18);
    ctx.lineTo(-6, 18);
    ctx.lineTo(-6, 44);
    ctx.quadraticCurveTo(-6, 50, -12, 52);
    ctx.lineTo(-20, 52);
    ctx.quadraticCurveTo(-22, 50, -22, 44);
    ctx.closePath();
    ctx.fill();
    // right leg
    ctx.beginPath();
    ctx.moveTo(14, 18);
    ctx.lineTo(6, 18);
    ctx.lineTo(6, 44);
    ctx.quadraticCurveTo(6, 50, 12, 52);
    ctx.lineTo(20, 52);
    ctx.quadraticCurveTo(22, 50, 22, 44);
    ctx.closePath();
    ctx.fill();

    // shin highlights
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-10, 26);
    ctx.lineTo(-10, 44);
    ctx.moveTo(10, 26);
    ctx.lineTo(10, 44);
    ctx.stroke();

    // toes / feet plates
    ctx.fillStyle = "#5e6366";
    ctx.beginPath();
    ctx.roundRect(-22, 52, 14, 8, 3);
    ctx.roundRect(8, 52, 14, 8, 3);
    ctx.fill();

    // rivets and panel seams for mechanical detail
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    const rivetPositions = [-14, -6, 6, 14];
    rivetPositions.forEach((rx) => {
      ctx.beginPath();
      ctx.arc(rx, -2, 1.2, 0, Math.PI * 2);
      ctx.fill();
    });

    // subtle battle damage tint if low hp
    if (this.hp < 120) {
      ctx.fillStyle = "rgba(180,30,30,0.06)";
      ctx.beginPath();
      ctx.roundRect(-28, -36, 56, 76, 6);
      ctx.fill();
    }

    ctx.restore();
  }
}

class House {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.level = 1; // 1 = simples, 2 = evoluída
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);

    // sombra
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(0, 14, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    if (this.level === 1) {
      // casa simples
      ctx.fillStyle = "#f0e0c0";
      ctx.strokeStyle = "#b08c5a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-16, -10, 32, 24, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#c55b3f";
      ctx.strokeStyle = "#7e3320";
      ctx.beginPath();
      ctx.moveTo(-20, -10);
      ctx.lineTo(0, -24);
      ctx.lineTo(20, -10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      // casa evoluída (maior, com chaminé)
      ctx.fillStyle = "#f7f0d8";
      ctx.strokeStyle = "#c29a64";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-20, -14, 40, 30, 5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#d26b45";
      ctx.strokeStyle = "#8b3922";
      ctx.beginPath();
      ctx.moveTo(-24, -14);
      ctx.lineTo(0, -30);
      ctx.lineTo(24, -14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // chaminé
      ctx.fillStyle = "#b08c5a";
      ctx.beginPath();
      ctx.roundRect(10, -24, 8, 10, 2);
      ctx.fill();
    }

    // porta
    ctx.fillStyle = "#8b5a2b";
    ctx.beginPath();
    ctx.roundRect(-5, 0, 10, 14, 2);
    ctx.fill();

    // janela
    ctx.fillStyle = "#a8d8ff";
    ctx.strokeStyle = "#6a8ca5";
    ctx.beginPath();
    ctx.roundRect(8, -3, 8, 8, 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }
}

class Market {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);

    // sombra
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 18, 24, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // base do prédio
    ctx.fillStyle = "#f5efe0";
    ctx.strokeStyle = "#b79a6a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-24, -6, 48, 28, 5);
    ctx.fill();
    ctx.stroke();

    // faixa colorida (toldo do mercado)
    const stripeColors = ["#ff5555", "#ffcc55", "#55c65a", "#55a6ff"];
    const stripeWidth = 8;
    for (let i = 0; i < stripeColors.length; i++) {
      ctx.fillStyle = stripeColors[i];
      ctx.beginPath();
      ctx.roundRect(-24 + i * stripeWidth * 1.2, -10, stripeWidth, 8, 2);
      ctx.fill();
    }

    // placa "Y" (Yoko)
    ctx.fillStyle = "#222";
    ctx.font = "10px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Y", 0, 5);

    // porta
    ctx.fillStyle = "#8b5a2b";
    ctx.beginPath();
    ctx.roundRect(-6, 4, 12, 16, 3);
    ctx.fill();

    // vitrines
    ctx.fillStyle = "#a8d8ff";
    ctx.strokeStyle = "#6a8ca5";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-20, 2, 10, 10, 2);
    ctx.roundRect(10, 2, 10, 10, 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }
}

class GameShop {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);

    // sombra
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(0, 22, 28, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    // glow for marquee
    const grad = ctx.createLinearGradient(-26, -10, 26, -10);
    grad.addColorStop(0, "#ff5f6d");
    grad.addColorStop(0.5, "#ffc371");
    grad.addColorStop(1, "#4facfe");

    // desenha faixa com brilho por baixo
    withGlow("rgba(255,140,120,0.7)", 18, () => {
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(-26, -12, 52, 10, 4);
      ctx.fill();
    });

    // base da loja de jogos (com leve iluminação)
    ctx.fillStyle = "#f2f4ff";
    ctx.strokeStyle = "#7a8cc4";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-26, -6, 52, 30, 6);
    ctx.fill();
    ctx.stroke();

    // ícone de controle (acrescenta brilho nos botões)
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.roundRect(-8, -4, 16, 10, 4);
    ctx.fill();
    // botões com leve glow
    withGlow("rgba(244,67,54,0.6)", 10, () => {
      ctx.fillStyle = "#f44336";
      ctx.beginPath();
      ctx.arc(-4, 1, 1.8, 0, Math.PI * 2);
      ctx.fill();
    });
    withGlow("rgba(76,175,80,0.6)", 10, () => {
      ctx.fillStyle = "#4caf50";
      ctx.beginPath();
      ctx.arc(4, 1, 1.8, 0, Math.PI * 2);
      ctx.fill();
    });

    // porta (sombra mais pronunciada)
    ctx.fillStyle = "#8b5a2b";
    ctx.beginPath();
    ctx.roundRect(-6, 4, 12, 18, 3);
    ctx.fill();

    // vitrines com leve brilho
    withGlow("rgba(160,216,255,0.5)", 12, () => {
      ctx.fillStyle = "#a8d8ff";
      ctx.beginPath();
      ctx.roundRect(-22, 4, 12, 12, 3);
      ctx.roundRect(10, 4, 12, 12, 3);
      ctx.fill();
    });
    ctx.strokeStyle = "#6a8ca5";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-22, 4, 12, 12, 3);
    ctx.roundRect(10, 4, 12, 12, 3);
    ctx.stroke();

    ctx.restore();
  }
}

class Mine {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.productionTimer = 0;
  }

  update(dt) {
    // conta quantos escavadores estão trabalhando perto da mina
    const minersWorking = humans.filter(
      (h) => h.role === "miner" && dist(h, this) < 20
    ).length;

    if (minersWorking > 0) {
      this.productionTimer += dt * minersWorking;
      // a cada ~2 segundos por escavador médio, gera um pouco de amandita
      const threshold = 2;
      while (this.productionTimer >= threshold) {
        this.productionTimer -= threshold;
        const angle = Math.random() * Math.PI * 2;
        const radius = 20 + Math.random() * 10;
        const rx = this.x + Math.cos(angle) * radius;
        const ry = this.y + Math.sin(angle) * radius;
        if (
          rx > 10 &&
          ry > 10 &&
          rx < canvas.width - 10 &&
          ry < canvas.height - 10
        ) {
          resources.push(new Resource(rx, ry, "amandita"));
        }
      }
    } else {
      // sem escavadores, desacelera o timer
      this.productionTimer = Math.max(0, this.productionTimer - dt * 0.5);
    }
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);

    // sombra
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(0, 20, 26, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // entrada da mina (rocha)
    ctx.fillStyle = "#5a4a42";
    ctx.strokeStyle = "#2e241f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-26, -6, 52, 32, 8);
    ctx.fill();
    ctx.stroke();

    // buraco escuro
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.roundRect(-16, 0, 32, 20, 6);
    ctx.fill();

    // suporte de madeira
    ctx.strokeStyle = "#8b5a2b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(-16, 18);
    ctx.moveTo(16, 0);
    ctx.lineTo(16, 18);
    ctx.moveTo(-16, 2);
    ctx.lineTo(16, 2);
    ctx.stroke();

    // trilhos
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, 12);
    ctx.lineTo(14, 20);
    ctx.moveTo(-10, 10);
    ctx.lineTo(18, 18);
    ctx.stroke();

    // pequena placa
    ctx.fillStyle = "#f4d14a";
    ctx.beginPath();
    ctx.roundRect(-8, -10, 16, 8, 3);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.font = "8px Arial";
    ctx.textAlign = "center";
    ctx.fillText("MINA", 0, -4);

    ctx.restore();
  }
}

class SmallCity {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);

    // rua vertical
    ctx.fillStyle = "#555";
    ctx.fillRect(-10, -120, 20, 240);

    // linha central da rua
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(0, -115);
    ctx.lineTo(0, 115);
    ctx.stroke();
    ctx.setLineDash([]);

    // função auxiliar para desenhar uma casinha pequena
    const drawSmallHouse = (offsetX, offsetY) => {
      ctx.save();
      ctx.translate(offsetX, offsetY);

      // corpo
      ctx.fillStyle = "#f7f0d8";
      ctx.strokeStyle = "#c29a64";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-12, -10, 24, 20, 3);
      ctx.fill();
      ctx.stroke();

      // telhado
      ctx.fillStyle = "#d26b45";
      ctx.strokeStyle = "#8b3922";
      ctx.beginPath();
      ctx.moveTo(-14, -10);
      ctx.lineTo(0, -20);
      ctx.lineTo(14, -10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // porta
      ctx.fillStyle = "#8b5a2b";
      ctx.beginPath();
      ctx.roundRect(-4, -2, 8, 12, 2);
      ctx.fill();

      // janela
      ctx.fillStyle = "#a8d8ff";
      ctx.strokeStyle = "#6a8ca5";
      ctx.beginPath();
      ctx.roundRect(6, -5, 6, 6, 2);
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    };

    // 10 casas enfileiradas na vertical de cada lado da rua
    const count = 10;
    const spacing = 22;
    const startY = -((count - 1) * spacing) / 2;

    for (let i = 0; i < count; i++) {
      const y = startY + i * spacing;
      // esquerda
      drawSmallHouse(-40, y);
      // direita
      drawSmallHouse(40, y);
    }

    ctx.restore();
  }
}

class Farm {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.food = 5;
    this.maxFood = 60;
  }

  update() {
    // regenera lentamente mesmo sem fazendeiro
    this.food = Math.min(this.maxFood, this.food + 0.005);
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);

    // sombra
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(0, 16, 20, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // terra
    ctx.fillStyle = "#8b5a2b";
    ctx.beginPath();
    ctx.roundRect(-20, -8, 40, 24, 4);
    ctx.fill();

    // fileiras de plantas
    const rows = 3;
    for (let i = 0; i < rows; i++) {
      const y = -4 + i * 6;
      const intensity = Math.min(1, this.food / this.maxFood + i * 0.1);
      const green = Math.floor(120 + 80 * intensity);
      ctx.strokeStyle = `rgb(40,${green},40)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-16, y);
      ctx.lineTo(16, y);
      ctx.stroke();
    }

    ctx.restore();
  }
}

class Cat {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.speed = 1.3;
    this.inside = false;
    this.insideTimer = 0;
  }

  update() {
    const nearestHouse = findNearest(this, houses);
    if (this.inside) {
      this.insideTimer--;
      if (this.insideTimer <= 0) {
        this.inside = false;
      }
      return;
    }

    let dirX = 0;
    let dirY = 0;

    if (nearestHouse) {
      const dx = nearestHouse.x - this.x;
      const dy = nearestHouse.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 10) {
        dirX = dx / d;
        dirY = dy / d;
      } else if (Math.random() < 0.01) {
        // entra na casa
        this.inside = true;
        this.insideTimer = 200 + Math.floor(Math.random() * 200);
      }
    }

    dirX += rand(-0.25, 0.25);
    dirY += rand(-0.25, 0.25);

    const len = Math.hypot(dirX, dirY) || 1;
    this.x += (dirX / len) * this.speed;
    this.y += (dirY / len) * this.speed;

    this.x = Math.max(5, Math.min(canvas.width - 5, this.x));
    this.y = Math.max(5, Math.min(canvas.height - 5, this.y));
  }

  draw() {
    if (this.inside) return; // escondido na casa

    ctx.save();
    ctx.translate(this.x, this.y);

    // sombra
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, 5, 6, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // corpo
    ctx.fillStyle = "#d0d0d0";
    ctx.beginPath();
    ctx.roundRect(-6, -6, 12, 8, 3);
    ctx.fill();

    // cabeça
    ctx.beginPath();
    ctx.roundRect(-5, -11, 10, 7, 3);
    ctx.fill();

    // orelhas
    ctx.fillStyle = "#c0c0c0";
    ctx.beginPath();
    ctx.moveTo(-4, -11);
    ctx.lineTo(-7, -15);
    ctx.lineTo(-1, -11);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(4, -11);
    ctx.lineTo(7, -15);
    ctx.lineTo(1, -11);
    ctx.closePath();
    ctx.fill();

    // olhos
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(-2, -8, 1, 0, Math.PI * 2);
    ctx.arc(2, -8, 1, 0, Math.PI * 2);
    ctx.fill();

    // rabo
    ctx.strokeStyle = "#d0d0d0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(6, -4);
    ctx.quadraticCurveTo(10, -8, 8, -1);
    ctx.stroke();

    ctx.restore();
  }
}

class Dog {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.speed = 1.5;
    this.inside = false;
    this.insideTimer = 0;
  }

  update() {
    const nearestHouse = findNearest(this, houses);
    if (this.inside) {
      this.insideTimer--;
      if (this.insideTimer <= 0) {
        this.inside = false;
      }
      return;
    }

    let dirX = 0;
    let dirY = 0;

    if (nearestHouse) {
      const dx = nearestHouse.x - this.x;
      const dy = nearestHouse.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 14) {
        dirX = dx / d;
        dirY = dy / d;
      } else if (Math.random() < 0.01) {
        // entra na casa
        this.inside = true;
        this.insideTimer = 200 + Math.floor(Math.random() * 200);
      }
    }

    dirX += rand(-0.18, 0.18);
    dirY += rand(-0.18, 0.18);

    const len = Math.hypot(dirX, dirY) || 1;
    this.x += (dirX / len) * this.speed;
    this.y += (dirY / len) * this.speed;

    this.x = Math.max(5, Math.min(canvas.width - 5, this.x));
    this.y = Math.max(5, Math.min(canvas.height - 5, this.y));
  }

  draw() {
    if (this.inside) return;

    ctx.save();
    ctx.translate(this.x, this.y);

    // sombra
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, 5, 7, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // corpo
    ctx.fillStyle = "#c89b5c";
    ctx.beginPath();
    ctx.roundRect(-7, -6, 14, 9, 3);
    ctx.fill();

    // cabeça
    ctx.beginPath();
    ctx.roundRect(-6, -11, 10, 7, 3);
    ctx.fill();

    // orelhas caídas
    ctx.beginPath();
    ctx.roundRect(-6, -11, 3, 6, 2);
    ctx.roundRect(3, -11, 3, 6, 2);
    ctx.fill();

    // olhos
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(-2, -8, 1, 0, Math.PI * 2);
    ctx.arc(2, -8, 1, 0, Math.PI * 2);
    ctx.fill();

    // coleira
    ctx.strokeStyle = "#e13b3b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-5, -6);
    ctx.lineTo(5, -6);
    ctx.stroke();

    // rabo
    ctx.strokeStyle = "#c89b5c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-7, -3);
    ctx.quadraticCurveTo(-11, -7, -8, -1);
    ctx.stroke();

    ctx.restore();
  }
}

function spawnHouseAnimal(x, y) {
  if (Math.random() < 0.5) {
    cats.push(new Cat(x + rand(-10, 10), y + rand(-10, 10)));
  } else {
    dogs.push(new Dog(x + rand(-10, 10), y + rand(-10, 10)));
  }
}

class Resource {
  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.type = type;
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);

    // shadow (soft)
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(0, 6, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // animated time-based parameter for subtle sparkle
    const t = (Date.now() % 1200) / 1200;
    const sparklePhase = Math.abs(Math.sin(t * Math.PI * 2));

    // determine if bright (gems/metals) and glow color
    const brightTypes = ["diamond", "ruby", "sapphire", "amandita", "gold", "topaz", "esmeralda", "ametista", "peridote", "aco", "aquamarino", "platina"];
    const isBright = brightTypes.includes(this.type);
    const glowMap = {
      diamond: "rgba(120,230,255,0.92)",
      ruby: "rgba(255,70,90,0.92)",
      sapphire: "rgba(50,140,255,0.92)",
      amandita: "rgba(255,120,200,0.92)",
      gold: "rgba(255,210,90,0.88)",
      topaz: "rgba(255,200,100,0.9)",
      esmeralda: "rgba(60,220,120,0.9)",
      ametista: "rgba(170,120,255,0.95)",
      peridote: "rgba(170,230,120,0.9)",
      aco: "rgba(200,200,210,0.9)",
      aquamarino: "rgba(100,220,210,0.95)",
      platina: "rgba(220,230,240,0.95)",
    };
    const glowCol = glowMap[this.type] || "rgba(255,255,255,0.7)";

    // helper to draw faceted gem silhouette with facet strokes
    const drawFaceted = (colorA, colorB, strokeCol, points) => {
      // colorA may be a string or an already-created CanvasGradient.
      // If it's a gradient, use it directly; otherwise create a new gradient from the two color strings.
      let fillStyle;
      if (colorA && typeof colorA.addColorStop === "function") {
        // colorA is already a CanvasGradient
        fillStyle = colorA;
      } else {
        const g = ctx.createLinearGradient(0, -12, 0, 10);
        g.addColorStop(0, colorA);
        g.addColorStop(1, colorB);
        fillStyle = g;
      }

      // main fill using the resolved fillStyle
      ctx.fillStyle = fillStyle;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
      ctx.fill();

      // subtle inner facets (light strokes)
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = 0.8;
      for (let i = 1; i < points.length - 1; i++) {
        ctx.beginPath();
        ctx.moveTo(
          points[0].x * 0.2 + points[i].x * 0.8,
          points[0].y * 0.2 + points[i].y * 0.8
        );
        ctx.lineTo(
          points[i].x * 0.6 + points[i + 1].x * 0.4,
          points[i].y * 0.6 + points[i + 1].y * 0.4
        );
        ctx.stroke();
      }
    };

    // core drawing for each type with richer visuals
    const drawCore = () => {
      if (this.type === "wood") {
        // wooden log with deeper rings and highlight
        ctx.fillStyle = "#6b4f2c";
        ctx.strokeStyle = "#3a2412";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.roundRect(-9, -10, 18, 14, 3);
        ctx.fill();
        ctx.stroke();

        // rings
        ctx.strokeStyle = "rgba(140,90,50,0.9)";
        ctx.lineWidth = 0.9;
        for (let i = -6; i <= 6; i += 3) {
          ctx.beginPath();
          ctx.ellipse(i * 0.1, -3 + (i * 0.07), 6 - Math.abs(i) * 0.6, 2 + Math.abs(i) * 0.18, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (this.type === "stone") {
        // rough stone with micro-speculars
        const base = "#7a7a7a";
        const inner = "#5a5a5a";
        const grad = ctx.createLinearGradient(0, -8, 0, 8);
        grad.addColorStop(0, lightenColor(base, 0.12));
        grad.addColorStop(1, inner);
        ctx.fillStyle = grad;
        ctx.strokeStyle = "#3f3f3f";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-9, -4);
        ctx.lineTo(-3, -10);
        ctx.lineTo(4, -9);
        ctx.lineTo(9, -3);
        ctx.lineTo(5, 3);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // small light specks
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(rand(-5, 6), rand(-6, 4), rand(0.6, 1.4), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (this.type === "iron") {
        // iron chunk with cooler metal sheen
        const g = ctx.createLinearGradient(0, -10, 0, 10);
        g.addColorStop(0, "#edf3f6");
        g.addColorStop(0.6, "#c3c7cc");
        g.addColorStop(1, "#9aa0a5");
        drawFaceted(g, "#9aa0a5", "rgba(255,255,255,0.08)", [
          { x: 0, y: -10 },
          { x: 7, y: -3 },
          { x: 5, y: 5 },
          { x: -5, y: 5 },
          { x: -8, y: -3 },
        ]);
        // thin metallic streaks
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-3, -3);
        ctx.lineTo(3, -6);
        ctx.stroke();
      } else if (this.type === "gold") {
        // faceted gold with warm glow
        const gA = "#fff1b8";
        const gB = "#ffcc3a";
        drawFaceted(gA, gB, "rgba(255,255,255,0.22)", [
          { x: 0, y: -10 },
          { x: 7, y: -2 },
          { x: 4, y: 6 },
          { x: -4, y: 6 },
          { x: -7, y: -2 },
        ]);
        // strong specular
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-1, -6);
        ctx.lineTo(1, -9);
        ctx.stroke();
      } else if (this.type === "diamond") {
        // diamond: multi-facet with cold blue-white facets
        const baseA = "#bff8ff";
        const baseB = "#62dff0";
        drawFaceted(baseA, baseB, "rgba(255,255,255,0.9)", [
          { x: 0, y: -11 },
          { x: 8, y: -2 },
          { x: 3, y: 9 },
          { x: -3, y: 9 },
          { x: -8, y: -2 },
        ]);
        // central sparkle (pulsing)
        const spR = 1.6 + sparklePhase * 1.8;
        withGlow("rgba(160,230,255,0.95)", 20, () => {
          ctx.fillStyle = "rgba(220,255,255,0.95)";
          ctx.beginPath();
          ctx.arc(0, -2, spR, 0, Math.PI * 2);
          ctx.fill();
        });
        // fine white lines
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(-2, -6);
        ctx.lineTo(0, -11);
        ctx.lineTo(2, -6);
        ctx.stroke();
      } else if (this.type === "ruby") {
        // ruby: deep red facets with warm highlights
        drawFaceted("#ffb3b8", "#b71c2a", "rgba(255,200,200,0.7)", [
          { x: 0, y: -11 },
          { x: 7, y: -3 },
          { x: 5, y: 7 },
          { x: -5, y: 7 },
          { x: -7, y: -3 },
        ]);
        // pulsing highlight
        withGlow("rgba(255,80,100,0.88)", 18 + sparklePhase * 8, () => {
          ctx.fillStyle = "rgba(255,120,130,0.95)";
          ctx.beginPath();
          ctx.arc(2, -3, 1.4 + sparklePhase * 0.8, 0, Math.PI * 2);
          ctx.fill();
        });
      } else if (this.type === "copper") {
        // copper with warm gradient and slight patina
        drawFaceted("#ffd9b8", "#b85b2a", "rgba(255,240,210,0.45)", [
          { x: 0, y: -9 },
          { x: 7, y: -1 },
          { x: 4, y: 6 },
          { x: -4, y: 6 },
          { x: -7, y: -1 },
        ]);
        ctx.fillStyle = "rgba(20,40,20,0.06)";
        ctx.beginPath();
        ctx.arc(-2, 1, 2.6, 0, Math.PI * 2);
        ctx.fill();
      } else if (this.type === "lapis") {
        // lapis: deep blue with bright specks
        drawFaceted("#6aa0ff", "#123e9a", "rgba(200,220,255,0.28)", [
          { x: -6, y: -6 },
          { x: -1, y: -10 },
          { x: 6, y: -6 },
          { x: 7, y: 4 },
          { x: -5, y: 4 },
        ]);
        // light specks (minerals)
        ctx.fillStyle = "rgba(220,240,255,0.6)";
        ctx.beginPath();
        ctx.arc(-2, -4, 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(2, -1, 0.7, 0, Math.PI * 2);
        ctx.fill();
      } else if (this.type === "sapphire") {
        // sapphire: saturated blue facets and crisp highlights
        drawFaceted("#cfe9ff", "#1f6be0", "rgba(220,240,255,0.8)", [
          { x: 0, y: -11 },
          { x: 6, y: -3 },
          { x: 4, y: 7 },
          { x: -4, y: 7 },
          { x: -6, y: -3 },
        ]);
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-1, -6);
        ctx.lineTo(1, -9);
        ctx.stroke();
      } else if (this.type === "netherite") {
        // netherite: heavy metallic block with layered detailing
        ctx.fillStyle = "#2b2626";
        ctx.strokeStyle = "#0f0b0a";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.roundRect(-9, -9, 18, 14, 3);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#6b5b52";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-6, -5);
        ctx.lineTo(6, -5);
        ctx.moveTo(-5, -1);
        ctx.lineTo(5, -1);
        ctx.stroke();
      } else if (this.type === "amandita") {
        // amandita: pink crystal with strong glow and internal facets
        drawFaceted("#ffd0f0", "#ff66c4", "rgba(255,230,250,0.9)", [
          { x: 0, y: -12 },
          { x: 7, y: -3 },
          { x: 5, y: 8 },
          { x: -5, y: 8 },
          { x: -7, y: -3 },
        ]);
        // glowing core
        withGlow("rgba(255,110,185,0.92)", 22 + sparklePhase * 10, () => {
          ctx.fillStyle = "rgba(255,150,210,0.9)";
          ctx.beginPath();
          ctx.arc(0, -2, 2 + sparklePhase * 1.4, 0, Math.PI * 2);
          ctx.fill();
        });
      } else if (this.type === "topaz") {
        // topaz: warm golden-orange gem with elongated facets
        drawFaceted("#fff1cf", "#ffb74d", "rgba(255,240,200,0.7)", [
          { x: 0, y: -12 },
          { x: 9, y: -3 },
          { x: 6, y: 8 },
          { x: -6, y: 8 },
          { x: -9, y: -3 },
        ]);
        withGlow("rgba(255,190,100,0.9)", 20 + sparklePhase * 6, () => {
          ctx.fillStyle = "rgba(255,220,140,0.9)";
          ctx.beginPath();
          ctx.arc(1, -2, 1.8 + sparklePhase * 0.9, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(-2, -6);
        ctx.lineTo(0, -11);
        ctx.lineTo(2, -6);
        ctx.stroke();
      } else if (this.type === "esmeralda" || this.type === "esmeralda") {
        // esmeralda (emerald): rich green, slightly rough crystalline shape with inner glow
        drawFaceted("#e6ffe8", "#2fb86b", "rgba(200,255,220,0.8)", [
          { x: 0, y: -10 },
          { x: 8, y: -1 },
          { x: 5, y: 7 },
          { x: -5, y: 7 },
          { x: -8, y: -1 },
        ]);
        withGlow("rgba(80,220,120,0.9)", 20 + sparklePhase * 5, () => {
          ctx.fillStyle = "rgba(120,240,150,0.9)";
          ctx.beginPath();
          ctx.arc(-1, -2, 1.6 + sparklePhase * 0.8, 0, Math.PI * 2);
          ctx.fill();
        });
        // small faceted veins
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(-2, -6);
        ctx.lineTo(0, -9);
        ctx.lineTo(2, -6);
        ctx.stroke();
      } else if (this.type === "ametista") {
        // ametista (amethyst): violet crystal with layered translucency and soft inner glow
        drawFaceted("#f3e6ff", "#a04be6", "rgba(220,180,255,0.9)", [
          { x: 0, y: -12 },
          { x: 7, y: -3 },
          { x: 5, y: 8 },
          { x: -5, y: 8 },
          { x: -7, y: -3 },
        ]);
        withGlow("rgba(170,120,255,0.96)", 22 + sparklePhase * 8, () => {
          ctx.fillStyle = "rgba(200,150,255,0.92)";
          ctx.beginPath();
          ctx.arc(0, -1.5, 2 + sparklePhase * 1.2, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(-2, -6);
        ctx.lineTo(0, -11);
        ctx.lineTo(2, -6);
        ctx.stroke();
      } else if (this.type === "aquamarino") {
        // aquamarino: cool teal gemstone, watery translucency and soft sea-glow
        drawFaceted("#e6fff9", "#2ecfc4", "rgba(200,255,250,0.9)", [
          { x: 0, y: -11 },
          { x: 8, y: -2 },
          { x: 5, y: 8 },
          { x: -5, y: 8 },
          { x: -8, y: -2 },
        ]);
        withGlow("rgba(100,220,210,0.92)", 20 + sparklePhase * 6, () => {
          ctx.fillStyle = "rgba(140,255,240,0.9)";
          ctx.beginPath();
          ctx.arc(0, -2, 1.8 + sparklePhase * 1.0, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.strokeStyle = "rgba(255,255,255,0.32)";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(-2, -6);
        ctx.lineTo(0, -10);
        ctx.lineTo(2, -6);
        ctx.stroke();
      } else if (this.type === "peridote" || this.type === "peridote") {
        // peridote (peridot): lime-green gem with slightly jagged facets and bright flecks
        drawFaceted("#f7ffe0", "#9fe04a", "rgba(240,255,200,0.8)", [
          { x: 0, y: -9 },
          { x: 7, y: -2 },
          { x: 4, y: 7 },
          { x: -4, y: 7 },
          { x: -7, y: -2 },
        ]);
        // tiny bright flecks
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(2, -3, 0.7 + sparklePhase * 0.6, 0, Math.PI * 2);
        ctx.fill();
        withGlow("rgba(170,235,90,0.9)", 16 + sparklePhase * 6, () => {
          ctx.fillStyle = "rgba(150,230,100,0.85)";
          ctx.beginPath();
          ctx.arc(0, -2, 1.4 + sparklePhase * 0.9, 0, Math.PI * 2);
          ctx.fill();
        });
      } else if (this.type === "platina") {
        // platina (platinum): bright, slightly warm white metal with refined sheen
        const gP = ctx.createLinearGradient(0, -8, 0, 8);
        gP.addColorStop(0, "#ffffff");
        gP.addColorStop(0.5, "#e7eef2");
        gP.addColorStop(1, "#c8d1d8");
        drawFaceted(gP, "#c8d1d8", "rgba(255,255,255,0.12)", [
          { x: -8, y: -6 },
          { x: 8, y: -6 },
          { x: 8, y: 6 },
          { x: -8, y: 6 },
        ]);
        // delicate polish streaks
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.lineWidth = 0.8;
        for (let s = -6; s <= 6; s += 3) {
          ctx.beginPath();
          ctx.moveTo(-6, s + rand(-0.4, 0.4));
          ctx.lineTo(6, s + rand(-0.4, 0.4));
          ctx.stroke();
        }
        // soft glow
        withGlow("rgba(220,230,240,0.9)", 18 + sparklePhase * 6, () => {
          ctx.fillStyle = "rgba(230,240,250,0.9)";
          ctx.beginPath();
          ctx.arc(0, -1, 1.6 + sparklePhase * 0.8, 0, Math.PI * 2);
          ctx.fill();
        });
      } else if (this.type === "aco") {
        // aço (steel): brushed metal plate with thin highlights and cool sheen
        const gSteel = ctx.createLinearGradient(0, -8, 0, 8);
        gSteel.addColorStop(0, "#f3f6fa");
        gSteel.addColorStop(0.45, "#c7ccd2");
        gSteel.addColorStop(1, "#9aa0a6");
        drawFaceted(gSteel, "#9aa0a6", "rgba(255,255,255,0.06)", [
          { x: -8, y: -6 },
          { x: 8, y: -6 },
          { x: 8, y: 6 },
          { x: -8, y: 6 },
        ]);
        // brushed streaks
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 0.8;
        for (let s = -6; s <= 6; s += 2.5) {
          ctx.beginPath();
          ctx.moveTo(-6, s + rand(-0.6, 0.6));
          ctx.lineTo(6, s + rand(-0.6, 0.6));
          ctx.stroke();
        }
        // cold rim
        ctx.strokeStyle = "rgba(200,210,220,0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-6, -6);
        ctx.lineTo(6, -6);
        ctx.lineTo(6, 6);
        ctx.lineTo(-6, 6);
        ctx.closePath();
        ctx.stroke();
      } else {
        // fallback: simple shiny nugget
        ctx.fillStyle = "#bdbdbd";
        ctx.beginPath();
        ctx.roundRect(-7, -7, 14, 12, 3);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(-2, -6);
        ctx.lineTo(2, -9);
        ctx.stroke();
      }
    };

    // if bright, draw glow beneath core with stronger radius, else a small subtle glow
    if (isBright) {
      withGlow(glowCol, 22, drawCore);
    } else {
      // subtle ambient glow for metals like iron/copper
      withGlow("rgba(0,0,0,0.04)", 6, drawCore);
    }

    // draw core shapes normally on top of glow for crisp edges
    drawCore();

    // animated micro-sparkles for gems
    if (isBright) {
      const sparkleCount = 2;
      for (let i = 0; i < sparkleCount; i++) {
        const angle = i * Math.PI + t * (0.8 + i * 0.2);
        const rx = Math.cos(angle) * (6 + i * 1.6);
        const ry = Math.sin(angle) * (3 + i * 1.2) - 2;
        const rsize = 0.9 + sparklePhase * 1.6 * (i + 1) * 0.6;
        ctx.fillStyle = "rgba(255,255,255," + (0.6 * (0.4 + sparklePhase * 0.6)) + ")";
        ctx.beginPath();
        ctx.arc(rx, ry, rsize, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

// Draw a small health bar at relative position (x,y) in the current transform or canvas coords.
// width is fixed, color shifts from green->yellow->red according to ratio.
function drawHealthBar(x, y, hp, maxHp) {
  const w = 44;
  const h = 6;
  const pad = 2;
  const ratio = Math.max(0, Math.min(1, hp / maxHp));
  // outer background
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.roundRect(-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2, 3);
  ctx.fill();
  // inner background
  ctx.fillStyle = "#2b2b2b";
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 2);
  ctx.fill();
  // bar color: green -> yellow -> red
  let barCol = "#4caf50";
  if (ratio < 0.45) barCol = "#ff5252";
  else if (ratio < 0.75) barCol = "#ffb300";
  ctx.fillStyle = barCol;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w * ratio, h, 2);
  ctx.fill();
  // thin border
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  // hp text (small)
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "8px Arial";
  ctx.textAlign = "center";
  ctx.fillText(Math.max(0, Math.floor(hp)) + "/" + maxHp, 0, 3.5);
  ctx.restore();
}

// utilitários de cor para melhorar as skins (usados nos sprites)
function lightenColor(hex, amount = 0.2) {
  const col = parseInt(hex.replace("#", ""), 16);
  const r = col >> 16;
  const g = (col >> 8) & 0xff;
  const b = col & 0xff;

  const nr = Math.min(255, Math.round(r + (255 - r) * amount));
  const ng = Math.min(255, Math.round(g + (255 - g) * amount));
  const nb = Math.min(255, Math.round(b + (255 - b) * amount));

  return (
    "#" +
    nr.toString(16).padStart(2, "0") +
    ng.toString(16).padStart(2, "0") +
    nb.toString(16).padStart(2, "0")
  );
}

function darkenColor(hex, amount = 0.2) {
  const col = parseInt(hex.replace("#", ""), 16);
  const r = col >> 16;
  const g = (col >> 8) & 0xff;
  const b = col & 0xff;

  const nr = Math.max(0, Math.round(r * (1 - amount)));
  const ng = Math.max(0, Math.round(g * (1 - amount)));
  const nb = Math.max(0, Math.round(b * (1 - amount)));

  return (
    "#" +
    nr.toString(16).padStart(2, "0") +
    ng.toString(16).padStart(2, "0") +
    nb.toString(16).padStart(2, "0")
  );
}

function loop(timestamp) {
  if (lastTime === null) lastTime = timestamp;
  const dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  // --- ATUALIZAÇÃO DA SIMULAÇÃO (respeita pausa e velocidade) ---
  if (!isPaused) {
    const steps = Math.max(1, simSpeed);

    for (let step = 0; step < steps; step++) {
      // atualizar Yoko: +10 por segundo para cada mercado existente
      yoko += markets.length * 10 * dt;
      // lojas de jogos dão um grande bônus de Yoko
      yoko += gameShops.length * 100 * dt;
      // minas de escavadores aumentam ainda mais o patrimônio
      yoko += mines.length * 50 * dt;

      // criar cidade pequena quando houver 35 casas ou mais (apenas uma vez)
      if (!smallCityCreated && houses.length >= 35) {
        smallCities.push(new SmallCity(canvas.width / 2, canvas.height / 2));
        smallCityCreated = true;
      }

          // minas
      mines.forEach((mine) => {
        mine.update(dt);
      });

      // fazendas
      farms.forEach((farm) => {
        farm.update();
      });

      // personagens
      humans.forEach((h) => {
        h.update();
      });

      gefs.forEach((g) => {
        g.update();
      });

      // golems protegem humanos e atacam monstros/rinocerontes
      golems.forEach((gl) => {
        gl.update();
      });

      rhinos.forEach((r) => {
        r.update();
      });

      aliens.forEach((a) => {
        a.update();
      });

      monsters.forEach((m) => {
        m.update();
      });

      // animais
      cats.forEach((c) => {
        c.update();
      });
      dogs.forEach((d) => {
        d.update();
      });
    }
  }

  yokoDisplay.textContent = "Yoko: " + Math.floor(yoko);

  // --- DESENHO (sempre desenha o estado atual) ---

  // fundo: varia conforme o mundo selecionado (terra, marte, lua) e formato escolhido (worldShape)
  ctx.save();

  // helper: draw water full-screen
  const drawWaterFull = (fillColor = "#5aa6ff") => {
    ctx.fillStyle = fillColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  // helper: draw grass full-screen with texture
  const drawGrassFull = () => {
    ctx.fillStyle = "#c8f1a6";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(30,100,30,0.12)";
    ctx.lineWidth = 2;
    const stripeSpacing = 36;
    for (let x = -stripeSpacing; x < canvas.width + stripeSpacing; x += stripeSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
  };

  // choose base palette per selected world (still used for grass/water tints)
  let grassColor = "#c8f1a6";
  let waterColor = "#5aa6ff";
  let rockColor = "#8f3320";
  let moonColor = "#9a9a9a";

  if (world === "earth") {
    grassColor = "#c8f1a6";
    waterColor = "#5aa6ff";
  } else if (world === "mars") {
    grassColor = "#9f624e"; // dusty tint for Mars
    waterColor = "#8f5a4a"; // muted "water" color (sandy)
    rockColor = "#8f3320";
  } else if (world === "moon") {
    grassColor = "#bdbdbd";
    waterColor = "#8e8e8e";
    moonColor = "#9a9a9a";
  }

  // render according to worldShape
  if (worldShape === "complete") {
    // everything is grass/ground (or the world's variant)
    if (world === "jupiter") {
      // draw horizontal banded Jupiter-like background
      const bandCount = 10;
      const baseHue = 25; // orange-ish base
      for (let i = 0; i < bandCount; i++) {
        const t = i / bandCount;
        // create slight variation in tone per band
        const r = Math.floor( (220 - i*8) );
        const g = Math.floor( (120 - i*4) );
        const b = Math.floor( (80 - i*3) );
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        const bandHeight = canvas.height / bandCount;
        // add some waviness
        ctx.beginPath();
        const yStart = i * bandHeight;
        ctx.moveTo(0, yStart + Math.sin(i * 1.7 + Date.now() * 0.0002) * 6);
        for (let x = 0; x <= canvas.width; x += 40) {
          const yy = yStart + Math.sin((x / canvas.width) * Math.PI * 2 + i) * 6;
          ctx.lineTo(x, yy);
        }
        ctx.lineTo(canvas.width, yStart + bandHeight + 24);
        ctx.lineTo(0, yStart + bandHeight + 24);
        ctx.closePath();
        ctx.fill();
      }
      // subtle swirling overlay
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      for (let j = 0; j < 6; j++) {
        ctx.beginPath();
        const rx = (j * 97) % canvas.width;
        const ry = ((j * 61) + 30) % canvas.height;
        ctx.ellipse(rx, ry, canvas.width * 0.18, canvas.height * 0.06, j * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = grassColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // subtle texture lines when not moon
      if (world !== "moon") {
        ctx.strokeStyle = "rgba(20,80,20,0.06)";
        ctx.lineWidth = 1;
        for (let y = 0; y < canvas.height; y += 18) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y - 8);
          ctx.stroke();
        }
      } else {
        // moon full: crater hint
        ctx.fillStyle = moonColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(50,50,50,0.06)";
        for (let i = 0; i < 18; i++) {
          const rx = (i * 73) % canvas.width;
          const ry = (i * 47) % canvas.height;
          const r = 10 + (i % 5) * 6;
          ctx.beginPath();
          ctx.ellipse(rx, ry, r, r * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  } else if (worldShape === "four") {
    // everything else is water, with 4 grass islands (circles) centered in quadrants
    drawWaterFull(waterColor);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = Math.min(canvas.width, canvas.height) * 0.20;

    const centers = [
      { x: cx * 0.5, y: cy * 0.5 },
      { x: cx * 1.5, y: cy * 0.5 },
      { x: cx * 0.5, y: cy * 1.5 },
      { x: cx * 1.5, y: cy * 1.5 },
    ];

    centers.forEach((c) => {
      ctx.save();
      // grass island fill
      ctx.beginPath();
      ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = grassColor;
      ctx.fill();

      // island stroke
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // optional texture lines on island
      ctx.strokeStyle = "rgba(20,80,20,0.06)";
      ctx.lineWidth = 1;
      for (let y = -radius; y < radius; y += 18) {
        ctx.beginPath();
        ctx.moveTo(c.x - radius, c.y + y);
        ctx.lineTo(c.x + radius, c.y + y - 8);
        ctx.stroke();
      }
      ctx.restore();
    });

    // vignette water edge
    ctx.fillStyle = "rgba(0,0,0,0.06)";
    ctx.fillRect(0, canvas.height * 0.7, canvas.width, canvas.height * 0.3);
  } else if (worldShape === "half") {
    // left half grass, right half water (or top/bottom if portrait)
    const verticalSplit = canvas.width >= canvas.height; // landscape prefers vertical split
    if (verticalSplit) {
      // left grass
      ctx.fillStyle = grassColor;
      ctx.fillRect(0, 0, canvas.width / 2, canvas.height);
      // right water
      ctx.fillStyle = waterColor;
      ctx.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height);

      // subtle seam
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, 0);
      ctx.lineTo(canvas.width / 2, canvas.height);
      ctx.stroke();
    } else {
      // top grass, bottom water
      ctx.fillStyle = grassColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height / 2);
      ctx.fillStyle = waterColor;
      ctx.fillRect(0, canvas.height / 2, canvas.width, canvas.height / 2);

      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    }

    // small texture on grass half
    ctx.strokeStyle = "rgba(20,80,20,0.06)";
    ctx.lineWidth = 1;
    for (let y = 0; y < canvas.height / 2; y += 18) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width / 2, y - 8);
      ctx.stroke();
    }
  } else {
    // fallback to full grass
    ctx.fillStyle = grassColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.restore();

  ctx.restore();

  // casas primeiro (para aparecerem no chão)
  houses.forEach((house) => house.draw());

  // cidades pequenas
  smallCities.forEach((city) => city.draw());

  // minas
  mines.forEach((mine) => {
    mine.draw();
  });

  // fazendas
  farms.forEach((farm) => {
    farm.draw();
  });

  // mercados
  markets.forEach((market) => market.draw());

  // lojas de jogos
  gameShops.forEach((shop) => shop.draw());

  // recursos
  resources.forEach((r) => r.draw());

  // personagens
  humans.forEach((h) => {
    h.draw();
  });

  gefs.forEach((g) => {
    g.draw();
  });

  // desenhar golems (antes dos rinocerontes para sobreposição)
  golems.forEach((gl) => {
    gl.draw();
  });

  rhinos.forEach((r) => {
    r.draw();
  });

  aliens.forEach((a) => {
    a.draw();
  });

  monsters.forEach((m) => {
    m.draw();
  });

  // animais
  cats.forEach((c) => {
    c.draw();
  });
  dogs.forEach((d) => {
    d.draw();
  });

  requestAnimationFrame(loop);
}

function buildGameShopsForGameCreators(gef) {
  if (!gef) return;
  const gameCreators = humans.filter((h) => h.role === "gameDev");
  // número de lojas alvo = número de criadores de jogos
  const targetShops = gameCreators.length;
  if (gameShops.length >= targetShops) return;

  const needed = targetShops - gameShops.length;
  const radius = 60;
  const angleStep = (Math.PI * 2) / Math.max(needed, 1);

  for (let i = 0; i < needed; i++) {
    const angle = i * angleStep;
    const gx = gef.x + Math.cos(angle) * radius;
    const gy = gef.y + Math.sin(angle) * radius;

    if (
      gx > 40 &&
      gy > 40 &&
      gx < canvas.width - 40 &&
      gy < canvas.height - 40
    ) {
      gameShops.push(new GameShop(gx, gy));
    }
  }
}

// GEF constrói uma mina assim que existir ao menos um escavador e um GEF
// (garante apenas uma mina compartilhada para todos os escavadores)
function ensureMineExists() {
  if (mines.length > 0) return;
  const anyMiner = humans.find((h) => h.role === "miner");
  const anyGef = gefs[0];
  if (!anyMiner || !anyGef) return;

  // posiciona a mina um pouco ao lado do GEF
  const angle = Math.random() * Math.PI * 2;
  const radius = 60;
  const mx = anyGef.x + Math.cos(angle) * radius;
  const my = anyGef.y + Math.sin(angle) * radius;
  if (
    mx > 40 &&
    my > 40 &&
    mx < canvas.width - 40 &&
    my < canvas.height - 40
  ) {
    mines.push(new Mine(mx, my));
  } else {
    // fallback: centro da tela
    mines.push(new Mine(canvas.width / 2, canvas.height / 2));
  }
}

requestAnimationFrame(loop);

// checa periodicamente se precisa criar a mina quando surgirem escavadores e GEFs
setInterval(ensureMineExists, 500);
