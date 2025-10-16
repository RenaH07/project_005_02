// 刺激ファイルのリスト
let stimuliFiles = [];
let currentIndex = -1;  // 初期状態は未選択
let isPlaying = false;
let animationId = null;

const displayNames = {
  '01_g0o0_j0_jp0_n0_np0__rot0__cut0-618': '01. ベースライン（追従-, 角度-, 速度-）',
  '02_g0o0_j80_jp197_n0p4_np619__rot0__cut0-1025': '02. 生物性操作（追従-, 角度±80°, 速度±40%）',
  '03_g1o0_j0_jp0_n0_np0': '03. 意図性操作（追従+, 角度-, 速度-）',
  '04_g1o0_j40_jp197_n0p2_np619': '04. 生物性・意図性両方操作 小（追従+, 角度±40°, 速度±20%）',
  '05_g1o0_j80_jp197_n0p4_np619': '05. 生物性・意図性両方操作 大（追従+, 角度±80°, 速度±40%）',
  '06_g1o0_j40_jp197_n0_np0': '06. 生物性操作 角度変化のみ 小（追従+, 角度±40°, 速度-）',
  '07_g1o0_j80_jp197_n0_np0': '07. 生物性操作 角度変化のみ 大（追従+, 角度±80°, 速度-）',
  '08_g1o0_j0_jp0_n0p2_np197': '08. 生物性操作 速度変化のみ 小（追従+, 角度-, 速度±20%）',
  '09_g1o0_j0_jp0_n0p4_np197': '09. 生物性操作 速度変化のみ 大（追従+, 角度-, 速度±40%）',
  '10_g1o1_j0_jp0_n0_np0': '10. 障害物あり（追従+, 角度-, 速度-, 衝突0）',
  '11_g1o1_j40_jp197_n0p2_np619': '11. 障害物あり（追従+, 角度±40°, 速度±20%, 衝突3）',
  '12_g1o1_j80_jp197_n0p4_np619': '12. 障害物あり（追従+, 角度±80°, 速度±40%, 衝突6）'
};

// Canvas要素
let canvas = null;
let ctx = null;

// 現在の刺激データ
let currentStimData = null;
let currentFrame = 0;

// 初期化
async function init() {
  try {
    const response = await fetch('stimuli/manifest.json');
    if (response.ok) {
      const manifest = await response.json();
      stimuliFiles = manifest.main.map(name => {
        const baseName = name.replace('.json', '');
        return {
          path: `stimuli/${name}`,
          name: displayNames[baseName] || baseName
        };
      });
    } else {
      // フォールバック
      stimuliFiles = Array.from({length: 12}, (_, i) => ({
        path: `stimuli/trial_${String(i+1).padStart(3, '0')}.json`,
        name: `trial_${String(i+1).padStart(3, '0')}`
      }));
    }
  } catch (e) {
    console.warn('manifest読み込み失敗、フォールバックを使用');
    stimuliFiles = Array.from({length: 12}, (_, i) => ({
      path: `stimuli/trial_${String(i+1).padStart(3, '0')}.json`,
      name: `trial_${String(i+1).padStart(3, '0')}`
    }));
  }
  
  // サイドバーに刺激リストを表示
  renderStimList();
}

// 刺激リストをレンダリング
function renderStimList() {
  const listEl = document.getElementById('stimList');
  listEl.innerHTML = '';
  
  stimuliFiles.forEach((stim, index) => {
    const li = document.createElement('li');
    li.className = 'stim-item';
    li.innerHTML = `
      <div class="name">${stim.name}</div>
      <div class="index">#${index + 1}</div>
    `;
    li.onclick = () => selectStimulus(index);
    listEl.appendChild(li);
  });
}

// 刺激を選択
function selectStimulus(index) {
  loadStimulus(index);
}

// 刺激データの正規化
function normalizeStim(raw) {
  // 新形式（frames + settings）
  if (Array.isArray(raw?.frames) && raw?.settings) {
    const colors = raw.settings.COLORS || {};
    const goalBase = raw.settings.GOAL || raw.goal || null;
    const obstacleBase = raw.settings.OBSTACLE || raw.obstacle || null;
    
    const goal = (raw.settings.USE_GOAL && goalBase)
      ? { ...goalBase, color: colors.goal || goalBase.color || '#ff6666' }
      : null;
    
    const obstacle = (raw.settings.USE_OBSTACLE && obstacleBase)
      ? { ...obstacleBase, color: colors.obstacle || obstacleBase.color || 'gray' }
      : null;
    
    return {
      W: raw.settings.W ?? raw.canvas?.width ?? 800,
      H: raw.settings.H ?? raw.canvas?.height ?? 600,
      BG: colors.bg || raw.settings.BG || raw.canvas?.background || '#ffffff',
      R: raw.settings.R ?? raw.parameters?.radius ?? 30,
      goal,
      obstacle,
      positions: raw.frames.map(f => ({ x: f.x, y: f.y })),
      color: colors.ball || raw.settings.BALL_COLOR || raw.ball?.color || '#333333'
    };
  }
  
  // 旧形式（ball.positions）
  if (raw?.ball && Array.isArray(raw.ball.positions)) {
    return {
      W: raw.canvas?.width ?? 800,
      H: raw.canvas?.height ?? 600,
      BG: raw.canvas?.background ?? '#ffffff',
      R: raw.parameters?.radius ?? 30,
      goal: raw.goal || null,
      obstacle: raw.obstacle || null,
      positions: raw.ball.positions.map(([x, y]) => ({ x, y })),
      color: raw.ball?.color ?? '#333333'
    };
  }
  
  return { W: 800, H: 600, BG: '#fff', R: 30, positions: [] };
}

// 刺激を読み込み
async function loadStimulus(index) {
  if (index < 0 || index >= stimuliFiles.length) return;
  
  // 再生中なら停止
  stopPlayback();
  
  currentIndex = index;
  currentFrame = 0;
  
  // UI更新
  updateUI();
  
  try {
    // Loading表示
    const wrapper = document.getElementById('canvasWrapper');
    wrapper.innerHTML = '<div class="loading"><div class="spinner"></div><p>読み込み中...</p></div>';
    
    // データ読み込み
    const response = await fetch(stimuliFiles[index].path);
    if (!response.ok) throw new Error('読み込み失敗');
    
    const rawData = await response.json();
    currentStimData = normalizeStim(rawData);
    
    // Canvas作成
    setupCanvas();
    
    // 最初のフレームを描画
    drawFrame();
    
  } catch (e) {
    console.error('刺激読み込みエラー:', e);
    const wrapper = document.getElementById('canvasWrapper');
    wrapper.innerHTML = '<div class="loading"><p>❌ 読み込みに失敗しました</p></div>';
  }
}

// Canvas セットアップ
function setupCanvas() {
  const wrapper = document.getElementById('canvasWrapper');
  wrapper.innerHTML = '';
  
  canvas = document.createElement('canvas');
  canvas.width = currentStimData.W;
  canvas.height = currentStimData.H;
  ctx = canvas.getContext('2d');
  
  // 画面に収まるようにスケール
  const maxW = Math.min(1000, window.innerWidth - 400);
  const maxH = Math.min(700, window.innerHeight - 300);
  const scale = Math.min(maxW / currentStimData.W, maxH / currentStimData.H, 1);
  
  canvas.style.width = (currentStimData.W * scale) + 'px';
  canvas.style.height = (currentStimData.H * scale) + 'px';
  
  wrapper.appendChild(canvas);
}

// フレーム描画
function drawFrame() {
  if (!currentStimData || !ctx) return;
  
  const pos = currentStimData.positions[currentFrame];
  if (!pos) return;
  
  // 背景
  ctx.fillStyle = currentStimData.BG;
  ctx.fillRect(0, 0, currentStimData.W, currentStimData.H);
  
  // Goal
  if (currentStimData.goal) {
    ctx.fillStyle = currentStimData.goal.color || '#ff6666';
    ctx.beginPath();
    ctx.arc(
      currentStimData.goal.x,
      currentStimData.goal.y,
      currentStimData.goal.radius || 15,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  
  // Obstacle
  if (currentStimData.obstacle) {
    ctx.fillStyle = currentStimData.obstacle.color || 'gray';
    ctx.fillRect(
      currentStimData.obstacle.x,
      currentStimData.obstacle.y,
      currentStimData.obstacle.width,
      currentStimData.obstacle.height
    );
  }
  
  // Ball
  ctx.fillStyle = currentStimData.color || '#333';
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, currentStimData.R, 0, Math.PI * 2);
  ctx.fill();
}

// アニメーションループ
function playbackLoop() {
  if (!isPlaying) return;
  
  currentFrame++;
  
  if (currentFrame >= currentStimData.positions.length) {
    // 終了
    stopPlayback();
    return;
  }
  
  drawFrame();
  animationId = requestAnimationFrame(playbackLoop);
}

// 再生/停止
function togglePlay() {
  if (!currentStimData) return;
  
  if (isPlaying) {
    stopPlayback();
  } else {
    startPlayback();
  }
}

function startPlayback() {
  if (!currentStimData) return;
  
  isPlaying = true;
  document.getElementById('playBtn').textContent = '⏸️ 停止';
  playbackLoop();
}

function stopPlayback() {
  isPlaying = false;
  document.getElementById('playBtn').textContent = '▶️ 再生';
  
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  
  // 最初のフレームに戻す
  currentFrame = 0;
  if (currentStimData) {
    drawFrame();
  }
}

// 前へ
function prevStimulus() {
  if (currentIndex > 0) {
    loadStimulus(currentIndex - 1);
  }
}

// 次へ
function nextStimulus() {
  if (currentIndex < stimuliFiles.length - 1) {
    loadStimulus(currentIndex + 1);
  }
}

// UI更新
function updateUI() {
  // 現在の刺激名を表示
  if (currentIndex >= 0) {
    document.getElementById('currentStimName').textContent = 
      `${stimuliFiles[currentIndex].name} (#${currentIndex + 1})`;
  }
  
  // リストの選択状態を更新
  const items = document.querySelectorAll('.stim-item');
  items.forEach((item, index) => {
    if (index === currentIndex) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
  
  // ボタンの有効/無効
  const hasStim = currentIndex >= 0;
  document.getElementById('playBtn').disabled = !hasStim;
  document.getElementById('prevBtn').disabled = currentIndex <= 0;
  document.getElementById('nextBtn').disabled = currentIndex >= stimuliFiles.length - 1;
}

// キーボード操作
document.addEventListener('keydown', (e) => {
  if (currentIndex < 0) return;  // 刺激が選択されていない場合は無効
  
  switch(e.key) {
    case 'ArrowLeft':
      prevStimulus();
      break;
    case 'ArrowRight':
      nextStimulus();
      break;
    case ' ':
      e.preventDefault();
      togglePlay();
      break;
  }
});

// 初期化実行
init();

// グローバルに公開（HTML から呼べるように）
window.selectStimulus = selectStimulus;
window.togglePlay = togglePlay;
window.prevStimulus = prevStimulus;
window.nextStimulus = nextStimulus;