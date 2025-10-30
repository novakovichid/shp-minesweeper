(() => {
  const DEFAULTS = {
    width: 10,
    height: 10,
    mines: 15,
  };
  const LIMITS = {
    width: { min: 5, max: 30 },
    height: { min: 5, max: 24 },
    mines: { min: 1 },
  };

  const HIDDEN_SYMBOL = '';
  const FLAG_SYMBOL = '🚩';
  const MINE_SYMBOL = '💣';
  const EXPLOSION_SYMBOL = '💥';

  const BASE_CELL_SIZE = 48;
  const BASE_GAP = 4;
  const BASE_PADDING = 14;
  const MIN_CELL_SIZE = 22;
  const MARGIN = 48;

  const boardEl = document.getElementById('board');
  const parametersEl = document.getElementById('parameters');
  const timerEl = document.getElementById('timer');
  const minesEl = document.getElementById('mines-remaining');
  const messagesEl = document.getElementById('messages');
  const resetButton = document.getElementById('reset-button');
  const headerEl = document.querySelector('.app-header');
  const infoPanelEl = document.querySelector('.info-panel');
  const appShellEl = document.querySelector('.app-shell');

  const { config, warnings: configWarnings } = parseConfigFromUrl();
  let totalCells = config.width * config.height;

  let mineLayout = new Array(totalCells).fill(false);
  let adjacentCounts = new Array(totalCells).fill(0);
  let cellStates = new Array(totalCells).fill('hidden');
  let cellElements = [];

  let isBoardReady = false;
  let revealedCells = 0;
  let flagsPlaced = 0;
  let timerId = null;
  let elapsedSeconds = 0;
  let gameState = 'ready';

  const paramInfo = renderParameters(config);
  const combinedWarnings = [...configWarnings, ...paramInfo.warnings];
  if (combinedWarnings.length > 0) {
    showMessage(combinedWarnings.join(' '));
  } else {
    showMessage('Готовы к игре! Нажмите на любую клетку, чтобы начать.');
  }
  parametersEl.textContent = paramInfo.text;
  minesEl.textContent = `Мин: ${config.mines}`;

  resetButton.addEventListener('click', () => {
    resetGame();
  });

  initializeBoard();
  resizeBoard();
  window.addEventListener('resize', () => {
    resizeBoard();
  });

  function parseConfigFromUrl() {
    const url = new URL(window.location.href);
    const params = url.searchParams;

    const warnings = [];

    const parseNumberParam = (names, fallback, limits, label) => {
      let rawValue;
      for (const name of names) {
        if (params.has(name)) {
          rawValue = params.get(name);
          break;
        }
      }

      const provided = rawValue !== undefined;
      let parsed = parseInt(rawValue, 10);
      if (Number.isNaN(parsed)) {
        parsed = fallback;
        if (provided) {
          warnings.push(`Параметр «${label}» задан некорректно и заменён на значение по умолчанию.`);
        }
      }

      if (typeof limits.min === 'number' && parsed < limits.min) {
        warnings.push(`Параметр «${label}» был увеличен до ${limits.min}.`);
        parsed = limits.min;
      }

      if (typeof limits.max === 'number' && parsed > limits.max) {
        warnings.push(`Параметр «${label}» был уменьшён до ${limits.max}.`);
        parsed = limits.max;
      }

      return parsed;
    };

    const width = parseNumberParam(['width', 'w', 'cols'], DEFAULTS.width, LIMITS.width, 'ширина');
    const height = parseNumberParam(['height', 'h', 'rows'], DEFAULTS.height, LIMITS.height, 'высота');

    const maxMines = Math.max(1, width * height - 1);
    const minesCandidate = parseNumberParam(
      ['mines', 'm'],
      DEFAULTS.mines,
      { min: LIMITS.mines.min, max: maxMines },
      'количество мин'
    );
    const mines = Math.min(maxMines, Math.max(LIMITS.mines.min, minesCandidate));

    if (minesCandidate > maxMines) {
      warnings.push('Количество мин было уменьшено, чтобы осталась хотя бы одна безопасная клетка.');
    }

    return {
      config: { width, height, mines },
      warnings,
    };
  }

  function renderParameters(cfg) {
    const text = `Поле: ${cfg.width} × ${cfg.height} · Мин: ${cfg.mines}`;
    return { text, warnings: [] };
  }

  function initializeBoard() {
    boardEl.innerHTML = '';
    boardEl.style.gridTemplateColumns = `repeat(${config.width}, var(--cell-size))`;
    cellElements = [];

    for (let index = 0; index < totalCells; index += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell hidden';
      cell.textContent = HIDDEN_SYMBOL;
      cell.dataset.index = String(index);
      cell.setAttribute('aria-label', 'Закрытая клетка');
      cell.addEventListener('click', onLeftClick);
      cell.addEventListener('contextmenu', onRightClick);
      boardEl.appendChild(cell);
      cellElements.push(cell);
    }
  }

  function onLeftClick(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) {
      return;
    }

    if (gameState === 'lost' || gameState === 'won') {
      return;
    }

    if (cellStates[index] === 'flagged') {
      return;
    }

    if (!isBoardReady) {
      prepareBoard(index);
      startTimer();
    }

    revealCell(index);
  }

  function onRightClick(event) {
    event.preventDefault();
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) {
      return;
    }

    if (gameState === 'lost' || gameState === 'won') {
      return;
    }

    toggleFlag(index);
  }

  function prepareBoard(firstIndex) {
    isBoardReady = true;
    mineLayout = new Array(totalCells).fill(false);
    adjacentCounts = new Array(totalCells).fill(0);

    const availableIndexes = [];
    for (let i = 0; i < totalCells; i += 1) {
      if (i !== firstIndex) {
        availableIndexes.push(i);
      }
    }

    shuffleArray(availableIndexes);
    const selected = availableIndexes.slice(0, config.mines);
    for (const mineIndex of selected) {
      mineLayout[mineIndex] = true;
    }

    for (let i = 0; i < totalCells; i += 1) {
      if (mineLayout[i]) {
        continue;
      }
      const neighbors = getNeighborIndexes(i);
      let count = 0;
      for (const n of neighbors) {
        if (mineLayout[n]) {
          count += 1;
        }
      }
      adjacentCounts[i] = count;
    }
  }

  function revealCell(index) {
    if (cellStates[index] === 'revealed') {
      return;
    }

    if (mineLayout[index]) {
      triggerLoss(index);
      return;
    }

    const stack = [index];

    while (stack.length > 0) {
      const current = stack.pop();
      if (cellStates[current] === 'revealed' || mineLayout[current]) {
        continue;
      }
      cellStates[current] = 'revealed';
      revealedCells += 1;

      const cellEl = cellElements[current];
      const count = adjacentCounts[current];
      cellEl.classList.remove('hidden', 'flagged', 'mine');
      removeNumberClass(cellEl);
      cellEl.classList.add('revealed');
      cellEl.textContent = count === 0 ? '' : String(count);
      cellEl.setAttribute('aria-label', count === 0 ? 'Пустая клетка' : `Число ${count}`);
      cellEl.classList.add(`number-${count}`);
      cellEl.dataset.number = String(count);

      if (count === 0) {
        const neighbors = getNeighborIndexes(current);
        for (const n of neighbors) {
          if (cellStates[n] !== 'revealed') {
            stack.push(n);
          }
        }
      }
    }

    checkWinCondition();
  }

  function toggleFlag(index) {
    if (cellStates[index] === 'revealed') {
      return;
    }

    const cellEl = cellElements[index];
    if (cellStates[index] === 'flagged') {
      cellStates[index] = 'hidden';
      flagsPlaced -= 1;
      cellEl.classList.remove('flagged');
      cellEl.classList.add('hidden');
      cellEl.textContent = HIDDEN_SYMBOL;
      cellEl.setAttribute('aria-label', 'Закрытая клетка');
    } else {
      cellStates[index] = 'flagged';
      flagsPlaced += 1;
      cellEl.classList.remove('hidden');
      cellEl.classList.add('flagged');
      cellEl.textContent = FLAG_SYMBOL;
      cellEl.setAttribute('aria-label', 'Клетка помечена флажком');
    }
    updateMinesCounter();
  }

  function triggerLoss(explodedIndex) {
    gameState = 'lost';
    stopTimer();
    showMessage('Вы подорвались! Попробуйте ещё раз.', 'lose');

    const explodedCell = cellElements[explodedIndex];
    explodedCell.classList.remove('hidden');
    explodedCell.classList.add('mine');
    explodedCell.textContent = EXPLOSION_SYMBOL;
    explodedCell.setAttribute('aria-label', 'Взорванная мина');

    for (let i = 0; i < totalCells; i += 1) {
      if (mineLayout[i] && i !== explodedIndex) {
        const cell = cellElements[i];
        cell.classList.remove('hidden', 'flagged');
        cell.classList.add('revealed', 'mine');
        cell.textContent = MINE_SYMBOL;
        cell.setAttribute('aria-label', 'Мина');
      }
    }
  }

  function checkWinCondition() {
    if (revealedCells === totalCells - config.mines) {
      gameState = 'won';
      stopTimer();
      showMessage(`Победа! Время: ${formatTime(elapsedSeconds)}.`, 'win');

      for (let i = 0; i < totalCells; i += 1) {
        if (mineLayout[i] && cellStates[i] !== 'flagged') {
          toggleFlag(i);
        }
      }
    }
  }

  function resetGame() {
    stopTimer();
    elapsedSeconds = 0;
    updateTimerDisplay();
    isBoardReady = false;
    revealedCells = 0;
    flagsPlaced = 0;
    gameState = 'ready';
    cellStates = new Array(totalCells).fill('hidden');
    mineLayout = new Array(totalCells).fill(false);
    adjacentCounts = new Array(totalCells).fill(0);
    showMessage('Новая партия началась. Удачи!');
    minesEl.textContent = `Мин: ${config.mines}`;

    for (const cell of cellElements) {
      cell.className = 'cell hidden';
      cell.textContent = HIDDEN_SYMBOL;
      cell.removeAttribute('data-number');
      cell.setAttribute('aria-label', 'Закрытая клетка');
    }
  }

  function getNeighborIndexes(index) {
    const x = index % config.width;
    const y = Math.floor(index / config.width);
    const neighbors = [];

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < config.width && ny >= 0 && ny < config.height) {
          neighbors.push(ny * config.width + nx);
        }
      }
    }

    return neighbors;
  }

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  function updateMinesCounter() {
    const remaining = Math.max(0, config.mines - flagsPlaced);
    minesEl.textContent = `Мин: ${remaining}`;
  }

  function startTimer() {
    if (timerId !== null) {
      return;
    }
    gameState = 'running';
    timerId = window.setInterval(() => {
      elapsedSeconds += 1;
      updateTimerDisplay();
    }, 1000);
  }

  function stopTimer() {
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  function updateTimerDisplay() {
    timerEl.textContent = formatTime(elapsedSeconds);
  }

  function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  function showMessage(text, type) {
    messagesEl.textContent = text;
    messagesEl.classList.remove('win', 'lose');
    if (type) {
      messagesEl.classList.add(type);
    }
    requestAnimationFrame(() => resizeBoard());
  }

  function removeNumberClass(cellEl) {
    if (cellEl.dataset.number) {
      cellEl.classList.remove(`number-${cellEl.dataset.number}`);
      cellEl.removeAttribute('data-number');
    }
  }

  function resizeBoard() {
    const availableWidth = Math.max(320, window.innerWidth - MARGIN);
    const headerHeight = headerEl ? headerEl.offsetHeight : 0;
    const infoHeight = infoPanelEl ? infoPanelEl.offsetHeight : 0;
    const shellStyles = appShellEl ? window.getComputedStyle(appShellEl) : null;
    const shellPadding = shellStyles
      ? parseFloat(shellStyles.paddingTop) + parseFloat(shellStyles.paddingBottom)
      : 0;
    const mainGap = shellStyles ? parseFloat(shellStyles.gap || '0') : 0;
    const availableHeight = Math.max(
      240,
      window.innerHeight - headerHeight - infoHeight - shellPadding - mainGap - MARGIN
    );

    const baseWidth = config.width * BASE_CELL_SIZE + (config.width - 1) * BASE_GAP;
    const baseHeight = config.height * BASE_CELL_SIZE + (config.height - 1) * BASE_GAP;

    const scale = Math.min(
      availableWidth / (baseWidth + BASE_PADDING * 2),
      availableHeight / (baseHeight + BASE_PADDING * 2),
      1
    );

    const cellSize = Math.max(MIN_CELL_SIZE, Math.floor(BASE_CELL_SIZE * scale));
    const gap = Math.max(2, Math.round(BASE_GAP * scale));
    const padding = Math.max(10, Math.round(BASE_PADDING * scale));

    boardEl.style.setProperty('--cell-size', `${cellSize}px`);
    boardEl.style.setProperty('--cell-gap', `${gap}px`);
    boardEl.style.setProperty('--board-padding', `${padding}px`);
  }
})();
