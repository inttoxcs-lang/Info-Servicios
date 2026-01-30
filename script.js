
// Simple Pong game with final score and credits by: Lucas Lespiault
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const W = canvas.width;
  const H = canvas.height;

  // Game settings
  const paddleWidth = 12;
  const paddleHeight = 90;
  const paddleSpeed = 6; // keyboard max speed
  const aiMaxSpeed = 4.2;
  const ballRadius = 8;
  const initialBallSpeed = 5;
  const speedIncreaseOnHit = 0.25; // slight speed increase each paddle hit
  const maxBallSpeed = 14;
  const winningScore = 7; // first to this wins

  // State
  const player = {
    x: 20,
    y: (H - paddleHeight) / 2,
    width: paddleWidth,
    height: paddleHeight,
    vy: 0
  };

  const cpu = {
    x: W - 20 - paddleWidth,
    y: (H - paddleHeight) / 2,
    width: paddleWidth,
    height: paddleHeight,
    vy: 0
  };

  const ball = {
    x: W / 2,
    y: H / 2,
    r: ballRadius,
    vx: 0,
    vy: 0,
    speed: initialBallSpeed
  };

  let score = { player: 0, cpu: 0 };
  let keys = { ArrowUp: false, ArrowDown: false };
  let pointerControl = false;

  let gameOver = false;
  let winner = null;
  let rafId = null;

  function resetBall(direction = null) {
    ball.x = W / 2;
    ball.y = H / 2;
    ball.speed = initialBallSpeed;
    const angle = (Math.random() * Math.PI / 4) - (Math.PI / 8); // -22.5 to +22.5 deg
    const dir = direction === 'left' ? -1 : direction === 'right' ? 1 : (Math.random() < 0.5 ? -1 : 1);
    ball.vx = dir * ball.speed * Math.cos(angle);
    ball.vy = ball.speed * Math.sin(angle);
  }

  function start() {
    gameOver = false;
    winner = null;
    resetBall();
    if (rafId == null) rafId = requestAnimationFrame(loop);
  }

  function restartGame() {
    // reset everything
    score.player = 0;
    score.cpu = 0;
    player.y = (H - player.height) / 2;
    cpu.y = (H - cpu.height) / 2;
    keys = { ArrowUp: false, ArrowDown: false };
    pointerControl = false;
    gameOver = false;
    winner = null;
    resetBall();
    // remove any temporary handlers for restart if present
    removeRestartHandlers();
    if (rafId == null) rafId = requestAnimationFrame(loop);
  }

  // Input handlers
  function onKeyDown(e) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      keys[e.key] = true;
      pointerControl = false; // when using keys, switch off mouse-follow
      e.preventDefault();
    } else if (gameOver && (e.key === 'Enter' || e.key === ' ')) {
      // restart on Enter or Space
      restartGame();
    }
  }

  function onKeyUp(e) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      keys[e.key] = false;
      e.preventDefault();
    }
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  // Mouse / pointer control for player's paddle
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    player.y = clamp(y - player.height / 2, 0, H - player.height);
    pointerControl = true;
  });

  // Touch support (touch move)
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) {
      const rect = canvas.getBoundingClientRect();
      const y = (e.touches[0].clientY - rect.top) * (canvas.height / rect.height);
      player.y = clamp(y - player.height / 2, 0, H - player.height);
      pointerControl = true;
    }
    e.preventDefault();
  }, { passive: false });

  // Restart handlers for final screen
  function onCanvasClickRestart() {
    if (gameOver) restartGame();
  }
  function onDocKeyRestart(e) {
    if (!gameOver) return;
    if (e.key === 'Enter' || e.key === ' ') {
      restartGame();
    }
  }
  function addRestartHandlers() {
    canvas.addEventListener('click', onCanvasClickRestart);
    document.addEventListener('keydown', onDocKeyRestart);
  }
  function removeRestartHandlers() {
    canvas.removeEventListener('click', onCanvasClickRestart);
    document.removeEventListener('keydown', onDocKeyRestart);
  }

  // Utility
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Collision detection between circle (ball) and rectangle (paddle)
  function ballHitsPaddle(ball, paddle) {
    // Find nearest point on rect to circle center
    const nearestX = clamp(ball.x, paddle.x, paddle.x + paddle.width);
    const nearestY = clamp(ball.y, paddle.y, paddle.y + paddle.height);
    const dx = ball.x - nearestX;
    const dy = ball.y - nearestY;
    return (dx * dx + dy * dy) <= (ball.r * ball.r);
  }

  function updatePlayer() {
    if (!pointerControl) {
      if (keys.ArrowUp && !keys.ArrowDown) {
        player.vy = -paddleSpeed;
      } else if (keys.ArrowDown && !keys.ArrowUp) {
        player.vy = paddleSpeed;
      } else {
        player.vy = 0;
      }
      player.y += player.vy;
      player.y = clamp(player.y, 0, H - player.height);
    }
  }

  function updateCPU() {
    // Simple AI: move toward ball with some max speed
    const targetY = ball.y - cpu.height / 2;
    const diff = targetY - cpu.y;
    // scale speed relative to distance to avoid jitter
    const move = clamp(diff * 0.12, -aiMaxSpeed, aiMaxSpeed);
    cpu.y += move;
    cpu.y = clamp(cpu.y, 0, H - cpu.height);
  }

  function endGame(who) {
    gameOver = true;
    winner = who; // 'player' or 'cpu'
    // show final screen (drawn on next frame)
    addRestartHandlers();
  }

  function updateBall() {
    ball.x += ball.vx;
    ball.y += ball.vy;

    // Top/bottom wall collision
    if (ball.y - ball.r <= 0) {
      ball.y = ball.r;
      ball.vy = -ball.vy;
    } else if (ball.y + ball.r >= H) {
      ball.y = H - ball.r;
      ball.vy = -ball.vy;
    }

    // Paddle collisions
    if (ball.vx < 0 && ballHitsPaddle(ball, player)) {
      // reflect
      ball.x = player.x + player.width + ball.r; // push out
      // Compute bounce angle depending on where it hit the paddle
      const relativeIntersectY = (player.y + player.height / 2) - ball.y;
      const normalized = relativeIntersectY / (player.height / 2); // -1 .. 1
      const bounceAngle = normalized * (Math.PI / 3); // max 60 deg
      ball.speed = Math.min(maxBallSpeed, ball.speed + speedIncreaseOnHit);
      ball.vx = Math.abs(Math.cos(bounceAngle) * ball.speed);
      ball.vy = -Math.sin(bounceAngle) * ball.speed;
    } else if (ball.vx > 0 && ballHitsPaddle(ball, cpu)) {
      ball.x = cpu.x - ball.r; // push out
      const relativeIntersectY = (cpu.y + cpu.height / 2) - ball.y;
      const normalized = relativeIntersectY / (cpu.height / 2);
      const bounceAngle = normalized * (Math.PI / 3);
      ball.speed = Math.min(maxBallSpeed, ball.speed + speedIncreaseOnHit);
      ball.vx = -Math.abs(Math.cos(bounceAngle) * ball.speed);
      ball.vy = -Math.sin(bounceAngle) * ball.speed;
    }

    // Score conditions
    if (ball.x - ball.r <= 0) {
      // CPU scores
      score.cpu += 1;
      if (score.cpu >= winningScore) {
        endGame('cpu');
      } else {
        resetBall('right');
      }
    } else if (ball.x + ball.r >= W) {
      // Player scores
      score.player += 1;
      if (score.player >= winningScore) {
        endGame('player');
      } else {
        resetBall('left');
      }
    }
  }

  function drawNet() {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    const step = 18;
    for (let y = 10; y < H; y += step) {
      ctx.beginPath();
      ctx.moveTo(W / 2, y);
      ctx.lineTo(W / 2, y + step / 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    // Clear
    ctx.clearRect(0, 0, W, H);

    // Background panel
    ctx.fillStyle = 'rgba(255,255,255,0.01)';
    roundRect(ctx, 0, 0, W, H, 6, true, false);

    // Net
    drawNet();

    // Paddles
    ctx.fillStyle = '#dbeffd';
    roundRect(ctx, player.x, player.y, player.width, player.height, 4, true, false);
    roundRect(ctx, cpu.x, cpu.y, cpu.width, cpu.height, 4, true, false);

    // Ball
    ctx.fillStyle = '#58d68d';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();

    // Score
    ctx.fillStyle = '#cfe9ff';
    ctx.font = '32px system-ui, Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${score.player}`, W * 0.25, 50);
    ctx.fillText(`${score.cpu}`, W * 0.75, 50);

    // Hint
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.font = '12px system-ui, Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Move left paddle with mouse or Arrow Up/Down', W / 2, H - 36);

    // Small credits always visible (subtle)
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.font = '11px system-ui, Arial';
    ctx.textAlign = 'right';
    ctx.fillText('by: Lucas Lespiault', W - 10, H - 12);

    // If game over, draw final overlay
    if (gameOver) {
      drawFinalOverlay();
    }
  }

  // Small helper to draw rounded rectangles
  function roundRect(ctx, x, y, w, h, r, fill, stroke) {
    if (typeof r === 'undefined') r = 5;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  function drawFinalOverlay() {
    // dark translucent overlay
    ctx.save();
    ctx.fillStyle = 'rgba(2,6,14,0.7)';
    ctx.fillRect(0, 0, W, H);

    // Panel
    const pw = 520;
    const ph = 260;
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    roundRect(ctx, px, py, pw, ph, 10, true, false);

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = '34px system-ui, Arial';
    ctx.textAlign = 'center';
    const title = winner === 'player' ? 'You Win!' : 'CPU Wins';
    ctx.fillText(title, W / 2, py + 54);

    // Final score
    ctx.fillStyle = '#cfe9ff';
    ctx.font = '22px system-ui, Arial';
    ctx.fillText(`Final Score — Player ${score.player}  :  ${score.cpu} CPU`, W / 2, py + 110);

    // Credits
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '16px system-ui, Arial';
    ctx.fillText('Credits — by: Lucas Lespiault', W / 2, py + 150);

    // Restart hint
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '14px system-ui, Arial';
    ctx.fillText('Click/Tap the canvas or press Enter to play again', W / 2, py + 196);

    ctx.restore();
  }

  function loop() {
    // only update positions if not game over
    if (!gameOver) {
      updatePlayer();
      updateCPU();
      updateBall();
      draw();
      rafId = requestAnimationFrame(loop);
    } else {
      // final draw and stop anim frame loop
      draw();
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      // leave the restart handlers active so the player can restart
    }
  }

  // Kick off
  start();

  // Expose some debug controls (optional)
  window._pong = {
    resetBall,
    score,
    player,
    cpu,
    ball,
    restartGame
  };
})();
