// Standalone Notes App - Full-Screen Canvas with Floating Toolbars
// Based on home.html functionality

(function(){
  'use strict';

  // ============================================
  // Utilities
  // ============================================
  function toast(msg){
    const el = document.getElementById('toast');
    if(!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(()=> el.style.display='none', 1600);
  }

  const STORAGE_PREFIX = 'notes_v5_';
  function saveState(key, data){
    try{
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
      return true;
    }catch(e){
      console.warn('Failed to save state:', e);
      return false;
    }
  }

  function loadState(key, defaultValue){
    try{
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      if(!raw) return defaultValue;
      return JSON.parse(raw);
    }catch(e){
      console.warn('Failed to load state:', e);
      return defaultValue;
    }
  }

  // Multi-board meta: { boards: [{id, title}], currentBoardId }
  function loadMeta(){
    const m = loadState('meta', null);
    if(m && Array.isArray(m.boards) && m.boards.length) return m;
    const defaultId = 'main';
    return { boards: [{ id: defaultId, title: 'Main' }], currentBoardId: defaultId };
  }
  function saveMeta(meta){
    saveState('meta', meta);
  }
  function loadBoardData(boardId){
    return loadState('board_' + boardId, null);
  }
  function saveBoardData(boardId, data){
    saveState('board_' + boardId, data);
  }
  function loadConnectionsData(boardId){
    return loadState('connections_' + boardId, []);
  }
  function saveConnectionsData(boardId, connections){
    saveState('connections_' + boardId, connections);
  }
  function loadConfig(){
    return loadState('config', { defaultTheme: 'yellow' });
  }
  function saveConfig(config){
    saveState('config', config);
  }



  // --------------------------------------------
  // Rich text + safety (GitHub/local mode)
  // --------------------------------------------
  function escapeHtml(str){
    return String(str||'').replace(/[&<>"']/g, (c)=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  // Allow a small, safe subset of formatting tags.
  function sanitizeRichText(input){
    if(input == null) return '';
    // If it's plain text (most cases), escape it.
    const s = String(input);
    // Heuristic: if it contains any tags, treat as html.
    const looksHtml = /<\/?[a-z][\s\S]*>/i.test(s);
    if(!looksHtml) return escapeHtml(s).replace(/\n/g,'<br>');
    const tpl = document.createElement('template');
    tpl.innerHTML = s;

    const ALLOW = new Set(['B','STRONG','I','EM','U','S','BR','P','DIV','SPAN','UL','OL','LI','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE','CODE','A']);
    const WALK = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT, null);

    const toStrip = [];
    while(WALK.nextNode()){
      const el = WALK.currentNode;
      if(!ALLOW.has(el.tagName)){
        toStrip.push(el);
        continue;
      }
      // strip all attributes except safe ones (never allow style — prevents CSS injection)
      [...el.attributes].forEach(a=>{
        const n=a.name.toLowerCase();
        if(n==='style'){ el.removeAttribute('style'); return; }
        if(el.tagName==='A' && (n==='href' || n==='target' || n==='rel')) return;
        if(n==='class') return; // keep classes for basic styling
        el.removeAttribute(a.name);
      });
      if(el.tagName==='A'){
        const href = el.getAttribute('href')||'';
        if(!/^https?:\/\//i.test(href) && !href.startsWith('#')){
          el.removeAttribute('href');
        }
        el.setAttribute('rel','noopener noreferrer');
        el.setAttribute('target','_blank');
      }
    }
    toStrip.forEach(el=>{
      const frag = document.createDocumentFragment();
      while(el.firstChild) frag.appendChild(el.firstChild);
      el.replaceWith(frag);
    });
    return tpl.innerHTML;
  }

  function dataURLtoBlob(dataURL){
    try{
      const parts = String(dataURL).split(',');
      const meta = parts[0] || '';
      const b64 = parts[1] || '';
      const m = /data:([^;]+);base64/.exec(meta);
      const mime = m ? m[1] : 'application/octet-stream';
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
      return new Blob([arr], {type:mime});
    }catch(_){
      return null;
    }
  }

  // --------------------------------------------
  // IndexedDB assets (mp3/mp4/images) — local only
  // --------------------------------------------
  const ASSET_DB = 'bytepad_assets_v5';
  const ASSET_STORE = 'assets';
  function openAssetDB(){
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(ASSET_DB, 1);
      req.onupgradeneeded = ()=>{
        const db = req.result;
        if(!db.objectStoreNames.contains(ASSET_STORE)){
          db.createObjectStore(ASSET_STORE);
        }
      };
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error);
    });
  }
  async function idbPut(key, value){
    const db = await openAssetDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(ASSET_STORE,'readwrite');
      tx.objectStore(ASSET_STORE).put(value, key);
      tx.oncomplete = ()=>{ db.close(); resolve(true); };
      tx.onerror = ()=>{ db.close(); reject(tx.error); };
    });
  }
  async function idbGet(key){
    const db = await openAssetDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(ASSET_STORE,'readonly');
      const req = tx.objectStore(ASSET_STORE).get(key);
      req.onsuccess = ()=>{ const v=req.result; db.close(); resolve(v); };
      req.onerror = ()=>{ db.close(); reject(req.error); };
    });
  }
  async function idbDel(key){
    const db = await openAssetDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(ASSET_STORE,'readwrite');
      tx.objectStore(ASSET_STORE).delete(key);
      tx.oncomplete = ()=>{ db.close(); resolve(true); };
      tx.onerror = ()=>{ db.close(); reject(tx.error); };
    });
  }
  async function idbGetAllKeys(){
    const db = await openAssetDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(ASSET_STORE,'readonly');
      const req = tx.objectStore(ASSET_STORE).getAllKeys();
      req.onsuccess = ()=>{ db.close(); resolve(req.result || []); };
      req.onerror = ()=>{ db.close(); reject(req.error); };
    });
  }

  function makeAssetId(){
    return 'a_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function bringToFront(node){
    const board = node.parentElement;
    if(!board) return;
    const zs = [...board.querySelectorAll('.note')].map(n=>parseInt(n.style.zIndex||'0',10));
    const top = zs.length ? Math.max(...zs) : 0;
    node.style.zIndex = String(top + 1);
  }

  function bringNoteToTop(noteEl){
    if(!noteEl || !noteEl.classList.contains('note')) return;
    board.querySelectorAll('.note').forEach(n=> n.classList.remove('note-on-top'));
    noteEl.classList.add('note-on-top');
  }

  function getNoteTags(noteEl){
    if(!noteEl || !noteEl.dataset.tags) return [];
    try{ return JSON.parse(noteEl.dataset.tags); } catch(_){ return []; }
  }
  function setNoteTags(noteEl, tags){
    if(!noteEl) return;
    noteEl.dataset.tags = JSON.stringify(tags);
  }

  function applyTagFilter(){
    const el = document.getElementById('tagSearchInput');
    const clearBtn = document.getElementById('tagSearchClear');
    const q = (el && el.value ? el.value.trim() : '').toLowerCase();
    if(clearBtn) clearBtn.style.display = q ? '' : 'none';
    board.querySelectorAll('.note').forEach(n=>{
      const match = !q || getNoteTags(n).some(t=> t.toLowerCase().includes(q));
      n.classList.toggle('tag-match', !!q && match);
      n.classList.toggle('tag-no-match', !!q && !match);
    });
  }

  function selectOnly(board, node){
    board.querySelectorAll('.selected').forEach(n=>n.classList.remove('selected'));
    if(node) node.classList.add('selected');
  }

  function selectToggle(board, node, additive){
    if(!additive) board.querySelectorAll('.selected').forEach(n=>n.classList.remove('selected'));
    if(node) node.classList.toggle('selected');
  }

  function selectedNodes(board){
    return [...board.querySelectorAll('.selected')];
  }

  // ============================================
  // History Manager (Undo/Redo)
  // ============================================
  function HistoryManager(key, opts){
    opts = opts || {};
    const h = { stack: [], idx: -1, max: opts.max || 60, applying: false };

    function push(state){
      if(h.applying) return;
      if(h.idx < h.stack.length - 1) h.stack = h.stack.slice(0, h.idx+1);
      h.stack.push(JSON.stringify(state));
      if(h.stack.length > h.max) h.stack.shift();
      h.idx = h.stack.length - 1;
    }

    function canUndo(){ return h.idx > 0; }
    function canRedo(){ return h.idx < h.stack.length - 1; }

    function undo(apply){
      if(!canUndo()) return false;
      h.idx--;
      h.applying = true;
      apply(JSON.parse(h.stack[h.idx]));
      h.applying = false;
      return true;
    }

    function redo(apply){
      if(!canRedo()) return false;
      h.idx++;
      h.applying = true;
      apply(JSON.parse(h.stack[h.idx]));
      h.applying = false;
      return true;
    }

    function peek(){
      if(h.idx < 0) return null;
      try{ return JSON.parse(h.stack[h.idx]); }catch(e){ return null; }
    }

    return { push, undo, redo, canUndo, canRedo, peek };
  }

  function bindUndoRedoShortcuts(applyUndo, applyRedo){
    window.addEventListener('keydown', (e)=>{
      const z = (e.key === 'z' || e.key === 'Z');
      const y = (e.key === 'y' || e.key === 'Y');
      if(!(e.ctrlKey || e.metaKey)) return;
      if(z && !e.shiftKey){
        e.preventDefault();
        applyUndo();
      } else if((z && e.shiftKey) || y){
        e.preventDefault();
        applyRedo();
      }
    });
  }

  // ============================================
  // Board Drop Handler
  // ============================================
  function enableBoardDrop(board, onDropItem){
    board.addEventListener('dragover', (e)=>{ e.preventDefault(); });
    board.addEventListener('drop', (e)=>{
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
      if(!raw) return;
      let obj=null;
      try{ obj = JSON.parse(raw); }catch(_){ return; }
      const rect = board.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      onDropItem(obj, x, y);
    });
  }

  // ============================================
  // Snap & Guides
  // ============================================
  function getBoardOverlay(board){
    let o = board.querySelector(':scope > ._overlay');
    if(!o){
      o = document.createElement('div');
      o.className = '_overlay';
      o.style.position = 'absolute';
      o.style.inset = '0';
      o.style.pointerEvents = 'none';
      o.style.zIndex = '9998';
      board.appendChild(o);
    }
    return o;
  }

  function clearGuides(board){
    const o = getBoardOverlay(board);
    o.querySelectorAll('.guide-line').forEach(n=>n.remove());
  }

  function showGuides(board, gx, gy){
    const o = getBoardOverlay(board);
    clearGuides(board);
    if(gx != null){
      const v = document.createElement('div');
      v.className = 'guide-line v';
      v.style.left = gx + 'px';
      o.appendChild(v);
    }
    if(gy != null){
      const h = document.createElement('div');
      h.className = 'guide-line h';
      h.style.top = gy + 'px';
      o.appendChild(h);
    }
  }

  function snap(value, grid){ return Math.round(value / grid) * grid; }

  let snapEnabled = true;
  function computeSnapAndGuides(board, node, x, y, opts){
    const snapOn = snapEnabled && !!opts.snap;
    const grid = opts.grid || 10;
    const tol = opts.tol || 6;

    let gx=null, gy=null;
    const rect = node.getBoundingClientRect();
    const brect = board.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    const others = [...board.querySelectorAll('.note')].filter(n => n !== node && !n.classList.contains('hidden'));
    const linesX = [];
    const linesY = [];
    others.forEach(n=>{
      const r = n.getBoundingClientRect();
      const lx = (parseFloat(n.style.left||'0'));
      const ly = (parseFloat(n.style.top||'0'));
      const rw = r.width;
      const rh = r.height;
      linesX.push(lx, lx + rw/2, lx + rw);
      linesY.push(ly, ly + rh/2, ly + rh);
    });

    const left = x;
    const cx = x + w/2;
    const right = x + w;
    const top = y;
    const cy = y + h/2;
    const bottom = y + h;

    function nearest(val, arr){
      let best=null, dist=1e9;
      for(const a of arr){
        const d = Math.abs(a - val);
        if(d < dist){ dist=d; best=a; }
      }
      return {best, dist};
    }

    const nxL = nearest(left, linesX);
    const nxC = nearest(cx, linesX);
    const nxR = nearest(right, linesX);

    if(nxL.best!=null && nxL.dist <= tol){ x = nxL.best; gx = nxL.best; }
    else if(nxC.best!=null && nxC.dist <= tol){ x = nxC.best - w/2; gx = nxC.best; }
    else if(nxR.best!=null && nxR.dist <= tol){ x = nxR.best - w; gx = nxR.best; }

    const nyT = nearest(top, linesY);
    const nyC = nearest(cy, linesY);
    const nyB = nearest(bottom, linesY);

    if(nyT.best!=null && nyT.dist <= tol){ y = nyT.best; gy = nyT.best; }
    else if(nyC.best!=null && nyC.dist <= tol){ y = nyC.best - h/2; gy = nyC.best; }
    else if(nyB.best!=null && nyB.dist <= tol){ y = nyB.best - h; gy = nyB.best; }

    if(snapOn){
      x = snap(x, grid);
      y = snap(y, grid);
      if(gx==null && (x % grid)==0) gx = null;
      if(gy==null && (y % grid)==0) gy = null;
    }

    return {x,y,gx,gy};
  }

  // ============================================
  // Lasso Selection
  // ============================================
  function enableLasso(board, opts){
    opts = opts || {};
    const wrap = board.parentElement;
    let lasso=null, start=null, active=false;

    function boardPoint(e){
      const r = board.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    board.addEventListener('pointerdown', (e)=>{
      if(e.button !== 0) return;
      if(e.target.closest('.note')) return;
      active = true;
      start = boardPoint(e);

      lasso = document.createElement('div');
      lasso.className = 'lasso';
      lasso.style.left = start.x + 'px';
      lasso.style.top  = start.y + 'px';
      lasso.style.width = '0px';
      lasso.style.height= '0px';
      getBoardOverlay(board).appendChild(lasso);

      if(!e.shiftKey) board.querySelectorAll('.selected').forEach(n=>n.classList.remove('selected'));
      board.setPointerCapture(e.pointerId);

      const onMove = (ev)=>{
        if(!active) return;
        const p = boardPoint(ev);
        const x = Math.min(start.x, p.x);
        const y = Math.min(start.y, p.y);
        const w = Math.abs(p.x - start.x);
        const h = Math.abs(p.y - start.y);
        lasso.style.left = x + 'px';
        lasso.style.top = y + 'px';
        lasso.style.width = w + 'px';
        lasso.style.height = h + 'px';
      };
      const onUp = (ev)=>{
        if(!active) return;
        active=false;
        board.releasePointerCapture(ev.pointerId);
        const lr = lasso.getBoundingClientRect();
        const br = board.getBoundingClientRect();
        const rect = {left: lr.left, top: lr.top, right: lr.right, bottom: lr.bottom};
        [...board.querySelectorAll('.note')].forEach(n=>{
          if(n.classList.contains('hidden')) return;
          const nr = n.getBoundingClientRect();
          const nrect = {left: nr.left, top: nr.top, right: nr.right, bottom: nr.bottom};
          if(rect.left <= nrect.right && rect.right >= nrect.left && rect.top <= nrect.bottom && rect.bottom >= nrect.top){
            n.classList.add('selected');
          }
        });
        lasso.remove();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  // ============================================
  // Group Resize
  // ============================================
  function groupResize(nodes, leader, newW, newH, minW, minH){
    const lw = leader._origW;
    const lh = leader._origH;
    const dw = newW - lw;
    const dh = newH - lh;
    nodes.forEach(n=>{
      const ow = n._origW;
      const oh = n._origH;
      const w = Math.max(minW, ow + dw);
      const h = Math.max(minH, oh + dh);
      n.style.width = w + 'px';
      n.style.height= h + 'px';
    });
  }

  // ============================================
  // Dock Window Manager
  // ============================================
  let dockLockEnabled = false;
  const defaultDockPositions = {
    dockTemplates: { left: 18, top: 50, width: 280, height: 400 },
    dockTools: { left: null, right: 18, top: 50, width: 240, height: 300 },
    dockLayers: { left: null, right: 18, top: 360, width: 240, height: 300 }
  };

  function enableDockWindows(){
    const windows = document.querySelectorAll('.dockwin');
    const saved = loadState('dockPositions', {});
    const lockState = loadState('dockLock', false);
    dockLockEnabled = lockState;

    windows.forEach(win => {
      const dockId = win.dataset.dock;
      const savedPos = saved[dockId] || defaultDockPositions[dockId] || {};
      
      // Apply saved position
      if(savedPos.left !== undefined && savedPos.left !== null) win.style.left = savedPos.left + 'px';
      if(savedPos.right !== undefined && savedPos.right !== null) win.style.right = savedPos.right + 'px';
      if(savedPos.top !== undefined && savedPos.top !== null) win.style.top = savedPos.top + 'px';
      if(savedPos.bottom !== undefined && savedPos.bottom !== null) win.style.bottom = savedPos.bottom + 'px';
      if(savedPos.width) win.style.width = savedPos.width + 'px';
      if(savedPos.height) win.style.height = savedPos.height + 'px';
      if(savedPos.minimized) win.classList.add('minimized');
      if(savedPos.hidden) win.classList.add('hidden');

      // Drag handler
      const bar = win.querySelector('.dockbar');
      if(bar && !dockLockEnabled){
        let dragging = false;
        let startX = 0, startY = 0, startLeft = 0, startTop = 0;

        bar.addEventListener('pointerdown', (e)=>{
          if(e.target.closest('.dockbtn')) return;
          dragging = true;
          const rect = win.getBoundingClientRect();
          startX = e.clientX;
          startY = e.clientY;
          startLeft = rect.left;
          startTop = rect.top;
          win.style.right = 'auto';
          win.style.bottom = 'auto';
          win.style.left = startLeft + 'px';
          win.style.top = startTop + 'px';
          win.style.zIndex = '6000';
        });

        window.addEventListener('pointermove', (e)=>{
          if(!dragging) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          win.style.left = (startLeft + dx) + 'px';
          win.style.top = (startTop + dy) + 'px';
        });

        window.addEventListener('pointerup', ()=>{
          if(dragging){
            dragging = false;
            saveDockPositions();
          }
        });
      }

      // Resize handler
      const resize = win.querySelector('.dockresize');
      if(resize && !dockLockEnabled){
        let resizing = false;
        let startX = 0, startY = 0, startW = 0, startH = 0;

        resize.addEventListener('pointerdown', (e)=>{
          e.preventDefault();
          resizing = true;
          const rect = win.getBoundingClientRect();
          startX = e.clientX;
          startY = e.clientY;
          startW = rect.width;
          startH = rect.height;
        });

        window.addEventListener('pointermove', (e)=>{
          if(!resizing) return;
          const dw = e.clientX - startX;
          const dh = e.clientY - startY;
          const newW = Math.max(240, startW + dw);
          const newH = Math.max(180, startH + dh);
          win.style.width = newW + 'px';
          win.style.height = newH + 'px';
        });

        window.addEventListener('pointerup', ()=>{
          if(resizing){
            resizing = false;
            saveDockPositions();
          }
        });
      }

      // Minimize/Close buttons
      win.querySelectorAll('.dockbtn').forEach(btn => {
        btn.addEventListener('click', (e)=>{
          e.stopPropagation();
          const action = btn.dataset.action;
          if(action === 'minimize'){
            win.classList.toggle('minimized');
            saveDockPositions();
          } else if(action === 'close'){
            win.classList.add('hidden');
            saveDockPositions();
          }
        });
      });
    });

    // Update lock state
    document.querySelectorAll('.dockwin').forEach(win => {
      win.classList.toggle('locked', dockLockEnabled);
    });
  }

  function saveDockPositions(){
    const positions = {};
    document.querySelectorAll('.dockwin').forEach(win => {
      const dockId = win.dataset.dock;
      const rect = win.getBoundingClientRect();
      positions[dockId] = {
        left: win.style.left ? parseFloat(win.style.left) : null,
        right: win.style.right && win.style.right !== 'auto' ? parseFloat(win.style.right) : null,
        top: win.style.top ? parseFloat(win.style.top) : null,
        bottom: win.style.bottom && win.style.bottom !== 'auto' ? parseFloat(win.style.bottom) : null,
        width: rect.width,
        height: rect.height,
        minimized: win.classList.contains('minimized'),
        hidden: win.classList.contains('hidden')
      };
    });
    saveState('dockPositions', positions);
  }

  function toggleDockLock(){
    dockLockEnabled = !dockLockEnabled;
    saveState('dockLock', dockLockEnabled);
    document.querySelectorAll('.dockwin').forEach(win => {
      win.classList.toggle('locked', dockLockEnabled);
    });
    const check = document.getElementById('dockLockCheck');
    if(check) check.classList.toggle('visible', dockLockEnabled);
    toast(dockLockEnabled ? 'Dock lock enabled' : 'Dock lock disabled');
  }

  function showAllToolbars(){
    document.querySelectorAll('.dockwin.hidden').forEach(win => {
      win.classList.remove('hidden');
    });
    saveDockPositions();
    toast('All toolbars shown');
  }

  // ============================================
  // Note-to-note connections (Bezier, per-board)
  // ============================================
  function generateBezierPath(boardEl, fromId, toId){
    const fromEl = boardEl.querySelector('.note[data-id="' + fromId + '"]');
    const toEl = boardEl.querySelector('.note[data-id="' + toId + '"]');
    if(!fromEl || !toEl) return '';
    const br = boardEl.getBoundingClientRect();
    const fr = fromEl.getBoundingClientRect();
    const tr = toEl.getBoundingClientRect();
    const fromX = fr.left - br.left + fr.width/2;
    const fromY = fr.top - br.top + fr.height/2;
    const toX = tr.left - br.left + tr.width/2;
    const toY = tr.top - br.top + tr.height/2;
    const midX = fromX + (toX - fromX)/2;
    const cp1x = midX;
    const cp1y = fromY - 40;
    const cp2x = midX;
    const cp2y = toY - 40;
    return 'M ' + fromX + ',' + fromY + ' C ' + cp1x + ',' + cp1y + ' ' + cp2x + ',' + cp2y + ' ' + toX + ',' + toY;
  }

  function isNoteInViewport(noteEl, boardEl, padding){
    if(!noteEl || !boardEl) return false;
    const pad = padding != null ? padding : 120;
    const left = parseFloat(noteEl.style.left) || 0;
    const top = parseFloat(noteEl.style.top) || 0;
    const w = noteEl.offsetWidth || 200;
    const h = noteEl.offsetHeight || 160;
    const vpL = boardEl.scrollLeft;
    const vpT = boardEl.scrollTop;
    const vpR = boardEl.scrollLeft + boardEl.clientWidth;
    const vpB = boardEl.scrollTop + boardEl.clientHeight;
    return !(left + w < vpL - pad || left > vpR + pad || top + h < vpT - pad || top > vpB + pad);
  }

  function renderConnections(boardEl, connectionsList, svgEl){
    if(!svgEl || !boardEl) return;
    svgEl.innerHTML = '';
    const notes = boardEl.querySelectorAll('.note');
    const ids = new Set([...notes].map(n=>n.dataset.id));
    connectionsList.forEach(c=>{
      if(!ids.has(c.from) || !ids.has(c.to)) return;
      const fromEl = boardEl.querySelector('.note[data-id="' + c.from + '"]');
      const toEl = boardEl.querySelector('.note[data-id="' + c.to + '"]');
      if(!fromEl || !toEl) return;
      if(!isNoteInViewport(fromEl, boardEl, 80) && !isNoteInViewport(toEl, boardEl, 80)) return;
      const d = generateBezierPath(boardEl, c.from, c.to);
      if(!d) return;
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d', d);
      path.setAttribute('fill','none');
      path.setAttribute('stroke','rgba(255,79,216,.55)');
      path.setAttribute('stroke-width','2');
      path.setAttribute('stroke-linecap','round');
      svgEl.appendChild(path);
    });
  }

  function addConnection(fromId, toId, connectionsList){
    if(fromId === toId) return;
    const exists = connectionsList.some(c=>(c.from===fromId&&c.to===toId)||(c.from===toId&&c.to===fromId));
    if(exists) return;
    connectionsList.push({ from: fromId, to: toId });
  }

  function deleteConnectionsForNote(noteId, connectionsList){
    for(let i = connectionsList.length - 1; i >= 0; i--){
      if(connectionsList[i].from === noteId || connectionsList[i].to === noteId)
        connectionsList.splice(i, 1);
    }
  }

  // ============================================
  // Menu Bar
  // ============================================
  function initMenuBar(){
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
      item.addEventListener('click', (e)=>{
        e.stopPropagation();
        const wasActive = item.classList.contains('active');
        menuItems.forEach(m => m.classList.remove('active'));
        if(!wasActive) item.classList.add('active');
      });
    });

    document.addEventListener('click', (e)=>{
      if(!e.target.closest('.menu-item')){
        menuItems.forEach(m => m.classList.remove('active'));
      }
    });

    // Menu actions
    document.querySelectorAll('.menu-option').forEach(opt => {
      opt.addEventListener('click', (e)=>{
        e.stopPropagation();
        const action = opt.dataset.action;
        handleMenuAction(action);
        menuItems.forEach(m => m.classList.remove('active'));
      });
    });
  }

  function handleMenuAction(action){
    switch(action){
      case 'new':
        (function(){
          const title = prompt('New board name', 'Board ' + (meta.boards.length + 1));
          if(!title) return;
          const id = 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
          meta.boards.push({ id, title });
          saveMeta(meta);
          loadBoard(id);
          if(typeof renderBoardPicker === 'function') renderBoardPicker();
          toast('Created: ' + title);
        })();
        break;
      case 'save':
        pushHistory();
        toast('Saved');
        break;
      case 'clear':
        if(confirm('Clear all notes and connections on this board?')){
          connections.length = 0;
          board.querySelectorAll('.note').forEach(n=>n.remove());
          pushHistoryDebounced();
          renderConnections(board, connections, connectionsSvg);
          toast('Cleared');
        }
        break;
      case 'export':
        (function(){
          const data = exportBoard();
          const boardTitle = (meta.boards.find(b=>b.id===currentBoardId)||{}).title || 'board';
          const payload = {
            format: 'BytePadStudioExport',
            version: 1,
            exportedAt: new Date().toISOString(),
            board: { id: currentBoardId, title: boardTitle, items: data.items },
            connections: connections.slice(),
            note: 'Asset blobs remain in browser. Re-import restores layout and connections.'
          };
          const json = JSON.stringify(payload, null, 2);
          const blob = new Blob([json], {type: 'application/json'});
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'bytepad-' + (boardTitle.replace(/\W+/g,'-').toLowerCase()) + '.json';
          a.click();
          URL.revokeObjectURL(a.href);
          toast('Exported');
        })();
        break;
      case 'saveAsFile':
        (function(){
          const data = exportBoard();
          const boardTitle = (meta.boards.find(b=>b.id===currentBoardId)||{}).title || 'board';
          const payload = {
            format: 'BytePadStudioExport',
            version: 1,
            exportedAt: new Date().toISOString(),
            board: { id: currentBoardId, title: boardTitle, items: data.items },
            connections: connections.slice(),
            note: 'Asset blobs remain in browser. Re-import restores layout and connections.'
          };
          const json = JSON.stringify(payload, null, 2);
          const blob = new Blob([json], {type: 'application/json'});
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = (boardTitle.replace(/\W+/g,'-').toLowerCase()) + '.bytepad';
          a.click();
          URL.revokeObjectURL(a.href);
          toast('Saved as file');
        })();
        break;
      case 'exportZip':
        if(exportBoardAsZipFn){
          exportBoardAsZipFn().catch(err=>{ toast('Export failed: ' + (err && err.message ? err.message : 'ZIP')); });
        } else { toast('Loading…'); }
        break;
      case 'import':
        (function(){
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.json,.bytepad,.zip,application/json,application/zip';
          input.onchange = (e)=>{
            const file = e.target.files[0];
            if(!file) return;
            const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip';
            if(isZip && importFromZipFn){
              importFromZipFn(file).catch(err=> toast('Import failed: ' + (err && err.message ? err.message : 'ZIP')));
              return;
            }
            const reader = new FileReader();
            reader.onload = (ev)=>{
              try{
                const data = JSON.parse(ev.target.result);
                if(data && data.format === 'BytePadStudioExport' && data.board){
                  const b = data.board;
                  const items = b.items || [];
                  applyState({ items });
                  connections.length = 0;
                  (data.connections || []).forEach(c=> addConnection(c.from, c.to, connections));
                  saveCurrentBoard();
                  renderConnections(board, connections, connectionsSvg);
                  toast('Imported ' + (b.title || 'board'));
                } else if(data && data.items){
                  applyState(data);
                  saveCurrentBoard();
                  toast('Imported');
                } else {
                  applyState(data);
                  saveCurrentBoard();
                  toast('Imported');
                }
                hist.push(exportBoard());
                refreshUndoRedo();
                renderLayers();
              }catch(err){
                toast('Import failed: ' + err.message);
              }
            };
            reader.readAsText(file);
          };
          input.click();
        })();
        break;
      case 'undo':
        doUndo();
        break;
      case 'redo':
        doRedo();
        break;
      case 'cut':
        cutNotesToClipboard();
        break;
      case 'copy':
        copyNotesToClipboard();
        break;
      case 'paste':
        pasteNotesFromClipboard();
        break;
      case 'delete':
        const sels = selectedNodes(board).filter(n=>n.classList.contains('note'));
        if(sels.length){
          sels.forEach(n=>{
            deleteConnectionsForNote(n.dataset.id, connections);
            if(n.dataset.assetId) idbDel(n.dataset.assetId).catch(()=>{});
            n.remove();
          });
          saveConnectionsData(currentBoardId, connections);
          renderConnections(board, connections, connectionsSvg);
          pushHistoryDebounced();
          renderLayers();
          toast('Deleted');
        }
        break;
      case 'selectAll':
        board.querySelectorAll('.note').forEach(n=>n.classList.add('selected'));
        toast('Selected all');
        break;
      case 'snapToggle':
        snapEnabled = !snapEnabled;
        saveState('snapEnabled', snapEnabled);
        const snapCheck = document.getElementById('snapCheck');
        if(snapCheck) snapCheck.classList.toggle('visible', snapEnabled);
        toast(snapEnabled ? 'Snap to grid enabled' : 'Snap to grid disabled');
        break;
      case 'dockLock':
        toggleDockLock();
        break;
      case 'showAllToolbars':
        showAllToolbars();
        break;
      case 'connectMode':
        toggleConnectMode();
        break;
      case 'open':
        handleMenuAction('import');
        break;
      case 'shortcuts':
        alert('Keyboard Shortcuts:\n\nCtrl+N - New board\nCtrl+S - Save\nCtrl+K - Command palette\nCtrl+Z - Undo\nCtrl+Y - Redo\nCtrl+X - Cut\nCtrl+C - Copy\nCtrl+V - Paste\nCtrl+A - Select All\nDel - Delete\nEsc - Deselect\nShift+Click - Multi-select\nConnect mode: click two notes to link.');
        break;
      case 'about':
        showAboutModal();
        break;
    }
  }

  // ============================================
  // Layers List
  // ============================================
  function renderLayers(){
    const layersList = document.getElementById('layersList');
    if(!layersList) return;
    const notes = [...board.querySelectorAll('.note')];
    if(notes.length === 0){
      layersList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px">No notes yet</div>';
      return;
    }
    layersList.innerHTML = notes.map((note, idx) => {
      const title = note.querySelector('.head .title')?.textContent || note.querySelector('.head strong')?.textContent || 'Note';
      const colorMatch = note.className.match(/\b(yellow|pink|blue|green|purple|classicYellow|whiteout|smokeSilver|blackout)\b/);
      const color = colorMatch ? colorMatch[1] : 'yellow';
      const isSelected = note.classList.contains('selected');
      return `
        <div class="layer-row ${isSelected ? 'active' : ''}" data-note-id="${note.dataset.id}">
          <span class="tag">${notes.length - idx}</span>
          <span class="name">${title}</span>
          <span class="chip" style="font-size:10px">${color}</span>
        </div>
      `;
    }).join('');
    layersList.querySelectorAll('.layer-row').forEach(row => {
      row.addEventListener('click', ()=>{
        const noteId = row.dataset.noteId;
        const note = board.querySelector(`.note[data-id="${noteId}"]`);
        if(note){
          selectOnly(board, note);
          bringToFront(note);
          renderLayers();
        }
      });
    });
  }

  // ============================================
  // Context Menu System
  // ============================================
  let contextMenu = null;

  function createContextMenu(){
    if(contextMenu) return contextMenu;
    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.id = 'globalContextMenu';
    document.body.appendChild(contextMenu);
    return contextMenu;
  }

  function showContextMenu(x, y, items){
    const menu = createContextMenu();
    menu.innerHTML = '';
    
    items.forEach(item => {
      if(item === '---'){
        const div = document.createElement('div');
        div.className = 'context-menu-divider';
        menu.appendChild(div);
      }else{
        const div = document.createElement('div');
        div.className = `context-menu-item${item.disabled ? ' disabled' : ''}`;
        div.textContent = item.label || item;
        if(item.shortcut){
          const kbd = document.createElement('span');
          kbd.className = 'kbd';
          kbd.textContent = item.shortcut;
          div.appendChild(kbd);
        }
        if(!item.disabled && item.action){
          div.addEventListener('click', (e) => {
            e.stopPropagation();
            item.action();
            hideContextMenu();
          });
        }
        menu.appendChild(div);
      }
    });

    menu.classList.add('visible');
    
    // Position menu
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    let left = x;
    let top = y;
    
    // Adjust if menu would go off screen
    if(left + rect.width > viewportWidth){
      left = viewportWidth - rect.width - 10;
    }
    if(top + rect.height > viewportHeight){
      top = viewportHeight - rect.height - 10;
    }
    if(left < 0) left = 10;
    if(top < 0) top = 10;
    
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function hideContextMenu(){
    if(contextMenu){
      contextMenu.classList.remove('visible');
    }
  }

  function enableContextMenu(element, getMenuItems){
    if(!element || typeof getMenuItems !== 'function') return;
    
    element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const items = getMenuItems(e);
      if(items && items.length > 0){
        showContextMenu(e.clientX, e.clientY, items);
      }
    });
  }

  // Close context menu on click outside or escape
  document.addEventListener('click', hideContextMenu);
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape'){
      hideContextMenu();
      hideAboutModal();
    }
  });

  // ============================================
  // About Modal
  // ============================================
  function showAboutModal(){
    const modal = document.getElementById('aboutModal');
    if(modal){
      modal.classList.add('visible');
    }
  }

  function hideAboutModal(){
    const modal = document.getElementById('aboutModal');
    if(modal){
      modal.classList.remove('visible');
    }
  }

  // Initialize modal handlers (called from main DOMContentLoaded)
  function initAboutModal(){
    const modal = document.getElementById('aboutModal');
    const closeBtn = document.getElementById('aboutModalClose');
    
    if(closeBtn){
      closeBtn.addEventListener('click', hideAboutModal);
    }
    
    if(modal){
      modal.addEventListener('click', (e)=>{
        if(e.target === modal){
          hideAboutModal();
        }
      });
    }
  }

  // ============================================
  // Image Drop Handler
  // ============================================
  function clearObjectURL(note){
    if(!note) return;
    if(note._objectURL){
      try{ URL.revokeObjectURL(note._objectURL); }catch(_){}
      note._objectURL = null;
    }
    if(note._playlistURLs){
      note._playlistURLs.forEach(u=>{ if(u) try{ URL.revokeObjectURL(u); }catch(_){} });
      note._playlistURLs = null;
    }
  }

  function renderAssetFromBlob(note, blob, kind, mime, name){
    clearObjectURL(note);
    const media = note.querySelector('.media');
    if(!media) return;
    media.innerHTML = '';
    if(!blob) return;

    const url = URL.createObjectURL(blob);
    note._objectURL = url;

    if(kind === 'image'){
      const img = document.createElement('img');
      img.src = url;
      img.alt = name || 'image';
      img.style.width = '100%';
      img.style.height = '140px';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '12px';
      media.appendChild(img);
      note.classList.add('has-media');
    } else if(kind === 'audio'){
      const a = document.createElement('audio');
      a.controls = true;
      a.src = url;
      a.style.width = '100%';
      media.appendChild(a);
      note.classList.add('has-media');
    } else if(kind === 'video'){
      const v = document.createElement('video');
      v.controls = true;
      v.src = url;
      v.style.width = '100%';
      v.style.maxHeight = '220px';
      v.style.borderRadius = '12px';
      media.appendChild(v);
      note.classList.add('has-media');
    }
  }

  async function attachFileToNote(note, file){
    const kind = file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('audio/') ? 'audio'
      : file.type.startsWith('video/') ? 'video'
      : 'file';

    const assetId = makeAssetId();
    await idbPut(assetId, { blob: file, mime: file.type, name: file.name, t: Date.now() });

    note.dataset.assetId = assetId;
    note.dataset.assetKind = kind;
    note.dataset.assetMime = file.type;
    note.dataset.assetName = file.name;

    renderAssetFromBlob(note, file, kind, file.type, file.name);
    pushHistoryDebounced();
    renderLayers();
    toast(kind === 'image' ? 'Image attached' : kind === 'audio' ? 'Audio attached' : kind === 'video' ? 'Video attached' : 'File attached');
  }

  function getPlaylist(note){
    if(!note || !note.dataset.playlist) return null;
    try{ return JSON.parse(note.dataset.playlist); } catch(_){ return null; }
  }

  async function renderPlaylistPlayer(note, tracks){
    if(!tracks || tracks.length === 0) return;
    clearObjectURL(note);
    const media = note.querySelector('.media');
    if(!media) return;
    media.innerHTML = '';

    const playlist = tracks;
    const urls = [];
    for(let i = 0; i < playlist.length; i++){
      try{
        const rec = await idbGet(playlist[i].assetId);
        if(rec && rec.blob) urls[i] = URL.createObjectURL(rec.blob);
        else urls[i] = null;
      } catch(_){ urls[i] = null; }
    }
    note._playlistURLs = urls;

    let currentIndex = 0;
    const audio = document.createElement('audio');
    audio.style.display = 'none';
    media.appendChild(audio);

    const wrap = document.createElement('div');
    wrap.className = 'playlist-player';

    const trackList = document.createElement('div');
    trackList.className = 'playlist-tracks';
    trackList.setAttribute('role', 'list');
    playlist.forEach((t, i)=>{
      const row = document.createElement('div');
      row.className = 'playlist-track-row';
      row.dataset.index = String(i);
      row.innerHTML = `<span class="playlist-track-num">${i + 1}</span><span class="playlist-track-name">${escapeHtml(t.name || 'Track ' + (i+1))}</span>`;
      trackList.appendChild(row);
    });
    wrap.appendChild(trackList);

    const controls = document.createElement('div');
    controls.className = 'playlist-controls';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'playlist-btn';
    prevBtn.innerHTML = '⏮';
    prevBtn.title = 'Previous';
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'playlist-btn playlist-btn-play';
    playBtn.innerHTML = '▶';
    playBtn.title = 'Play';
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'playlist-btn';
    nextBtn.innerHTML = '⏭';
    nextBtn.title = 'Next';
    const progressWrap = document.createElement('div');
    progressWrap.className = 'playlist-progress-wrap';
    const progress = document.createElement('div');
    progress.className = 'playlist-progress';
    progress.innerHTML = '<div class="playlist-progress-bar"></div>';
    const timeEl = document.createElement('span');
    timeEl.className = 'playlist-time';
    timeEl.textContent = '0:00 / 0:00';
    const volWrap = document.createElement('div');
    volWrap.className = 'playlist-volume';
    const volBtn = document.createElement('button');
    volBtn.type = 'button';
    volBtn.className = 'playlist-btn';
    volBtn.innerHTML = '🔊';
    volBtn.title = 'Volume';
    const volInput = document.createElement('input');
    volInput.type = 'range';
    volInput.className = 'playlist-vol-slider';
    volInput.min = 0;
    volInput.max = 100;
    volInput.value = 100;

    controls.appendChild(prevBtn);
    controls.appendChild(playBtn);
    controls.appendChild(nextBtn);
    controls.appendChild(progressWrap);
    progressWrap.appendChild(progress);
    controls.appendChild(timeEl);
    volWrap.appendChild(volBtn);
    volWrap.appendChild(volInput);
    controls.appendChild(volWrap);
    wrap.appendChild(controls);
    media.appendChild(wrap);
    note.classList.add('has-media', 'has-playlist');

    function setTrack(i){
      currentIndex = Math.max(0, Math.min(i, playlist.length - 1));
      trackList.querySelectorAll('.playlist-track-row').forEach((r, idx)=>{ r.classList.toggle('active', idx === currentIndex); });
      if(note._playlistURLs && note._playlistURLs[currentIndex]){
        audio.src = note._playlistURLs[currentIndex];
        audio.load();
      }
    }
    function updateTime(){
      const c = audio.currentTime;
      const d = audio.duration;
      const cm = Math.floor(c/60); const cs = Math.floor(c%60);
      const dm = isFinite(d) ? Math.floor(d/60) : 0; const ds = isFinite(d) ? Math.floor(d%60) : 0;
      timeEl.textContent = cm + ':' + (cs<10?'0':'') + cs + ' / ' + dm + ':' + (ds<10?'0':'') + ds;
      const bar = progress.querySelector('.playlist-progress-bar');
      if(bar && isFinite(d) && d > 0) bar.style.width = (100 * c / d) + '%';
    }
    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateTime);
    audio.addEventListener('ended', ()=>{ if(currentIndex < playlist.length - 1){ setTrack(currentIndex + 1); audio.play(); } else { playBtn.innerHTML = '▶'; } });

    playBtn.addEventListener('click', ()=>{
      if(audio.paused){ audio.play(); playBtn.innerHTML = '⏸'; playBtn.title = 'Pause'; }
      else{ audio.pause(); playBtn.innerHTML = '▶'; playBtn.title = 'Play'; }
    });
    prevBtn.addEventListener('click', ()=>{ setTrack(currentIndex - 1); audio.play(); playBtn.innerHTML = '⏸'; });
    nextBtn.addEventListener('click', ()=>{ setTrack(currentIndex + 1); audio.play(); playBtn.innerHTML = '⏸'; });
    volInput.addEventListener('input', ()=>{ audio.volume = volInput.value / 100; });

    progress.addEventListener('click', (e)=>{
      if(!audio.duration || !isFinite(audio.duration)) return;
      const rect = progress.getBoundingClientRect();
      const p = (e.clientX - rect.left) / rect.width;
      audio.currentTime = p * audio.duration;
      updateTime();
    });

    trackList.querySelectorAll('.playlist-track-row').forEach(row=>{
      row.addEventListener('click', ()=>{ setTrack(parseInt(row.dataset.index, 10)); audio.play(); playBtn.innerHTML = '⏸'; });
    });

    setTrack(0);
  }

  async function attachPlaylistToNote(note, audioFiles){
    const list = [];
    for(let i = 0; i < audioFiles.length; i++){
      const file = audioFiles[i];
      const assetId = makeAssetId();
      await idbPut(assetId, { blob: file, mime: file.type, name: file.name, t: Date.now() });
      list.push({ assetId, name: file.name });
    }
    note.dataset.playlist = JSON.stringify(list);
    note.dataset.assetId = list[0].assetId;
    note.dataset.assetKind = 'audio';
    note.dataset.assetName = list[0].name;
    await renderPlaylistPlayer(note, list);
    pushHistoryDebounced();
    renderLayers();
    toast('Playlist: ' + list.length + ' track(s)');
  }

  async function hydrateAssets(){
    // Spread to a real array (do not use [.board...] or [board...] — must iterate notes)
    const notes = [...board.querySelectorAll('.note[data-asset-id]')];
    for(const n of notes){
      const media = n.querySelector('.media');
      const playlist = getPlaylist(n);
      if(playlist && playlist.length > 0){
        if(media && media.querySelector('.playlist-player')) continue;
        try{
          await renderPlaylistPlayer(n, playlist);
        } catch(err){
          console.warn('[BytePad] hydrateAssets playlist error', err);
          if(media) media.innerHTML = '<div class="muted" style="font-size:12px;opacity:.75">Playlist load failed</div>';
        }
        continue;
      }
      const assetId = n.dataset.assetId;
      const kind = n.dataset.assetKind || 'file';
      if(media && media.children.length) continue;
      try{
        const rec = await idbGet(assetId);
        if(rec && rec.blob){
          renderAssetFromBlob(n, rec.blob, kind, rec.mime, rec.name);
        } else {
          if(media){
            media.innerHTML = '<div class="muted" style="font-size:12px;opacity:.75">Missing media (not in this browser storage)</div>';
          }
        }
      }catch(err){
        console.warn('[BytePad] hydrateAssets error', err);
      }
    }
  }

  function handleImageDrop(e, targetNote){
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer.files;
    if(!files || files.length === 0) return;

    const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/'));
    const hasMultipleAudio = !targetNote && audioFiles.length > 1;

    if(hasMultipleAudio){
      const rect = board.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const n = makeNote({ color: loadConfig().defaultTheme || 'yellow', title: 'Playlist', text: '', x, y });
      bringToFront(n);
      board.appendChild(n);
      attachPlaylistToNote(n, audioFiles).catch(err=>{
        console.error('[BytePad] attachPlaylistToNote error', err);
        toast('Could not create playlist');
      });
      return;
    }

    const file = Array.from(files).find(f =>
      f.type.startsWith('image/') || f.type.startsWith('audio/') || f.type.startsWith('video/')
    );
    if(!file){
      toast('Drop an image, audio, or video file');
      return;
    }

    const rect = board.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const n = targetNote || makeNote({ color: loadConfig().defaultTheme || 'yellow', title: file.name || 'Media', text:'', x, y });
    if(!targetNote){
      bringToFront(n);
      board.appendChild(n);
    }
    attachFileToNote(n, file).catch(err=>{
      console.error('[BytePad] attachFileToNote error', err);
      toast('Could not attach media');
    });
  }

  // ============================================
  // Main App (board + makeNote hoisted so handleImageDrop can use them)
  // ============================================
  let board = null;
  let makeNote = null;
  let connectionsSvg, hist, pushHistoryDebounced, doUndo, doRedo, refreshUndoRedo, exportBoard, applyState, pushHistory;
  let meta, currentBoardId, connections, connectMode, connectFrom;
  let exportBoardAsZipFn = null;
  let importFromZipFn = null;

  document.addEventListener('DOMContentLoaded', ()=>{
    board = document.getElementById('board');
    connectionsSvg = document.getElementById('connectionsSvg');
    meta = loadMeta();
    currentBoardId = meta.currentBoardId;
    connections = loadConnectionsData(currentBoardId);
    connectMode = false;
    connectFrom = null;

    // Load snap state
    snapEnabled = loadState('snapEnabled', true);
    const snapCheck = document.getElementById('snapCheck');
    if(snapCheck) snapCheck.classList.toggle('visible', snapEnabled);

    // Lasso select
    enableLasso(board);

    // Redraw connections on scroll (for viewport culling and path position)
    let renderConnectionsScrollTimer;
    board.addEventListener('scroll', ()=>{
      clearTimeout(renderConnectionsScrollTimer);
      renderConnectionsScrollTimer = setTimeout(()=> renderConnections(board, connections, connectionsSvg), 50);
    });

    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');

    // History
    hist = HistoryManager('notes', {max: 80});
    exportBoard = function(){
      const items = [...board.querySelectorAll('.note')].map(n=>{
        const body = n.querySelector('.body');
        const textDiv = body ? body.querySelector('.body-text') : null;
        const colorMatch = n.className.match(/\b(yellow|pink|blue|green|purple|classicYellow|whiteout|smokeSilver|blackout)\b/);
        const color = colorMatch ? colorMatch[1] : 'yellow';
        return {
          id: n.dataset.id,
          color: color,
          title: n.querySelector('.head .title')?.textContent || 'Note',
          html: textDiv ? textDiv.innerHTML : '',
          tags: getNoteTags(n),
          assetId: n.dataset.assetId || null,
          assetKind: n.dataset.assetKind || null,
          assetMime: n.dataset.assetMime || null,
          assetName: n.dataset.assetName || null,
          playlist: n.dataset.playlist ? (function(){ try{ return JSON.parse(n.dataset.playlist); }catch(_){ return null; }})() : null,
          x: parseFloat(n.style.left||'0'),
          y: parseFloat(n.style.top||'0'),
          w: parseFloat(n.style.width||'220'),
          h: parseFloat(n.style.height||'170'),
          z: parseInt(n.style.zIndex||'0',10)
        };
      });
      return { v:4, items };
    };
    applyState = function(data){
      board.querySelectorAll('.note').forEach(n=>n.remove());
      (data.items||[]).forEach(it=>{
        // Back-compat: older exports used .text and .image
        const merged = {
          ...it,
          text: (it.html != null ? it.html : it.text || ''),
          title: it.title || 'Note'
        };
        const note = makeNote(merged);

        // Back-compat: inline image data
        if(it.image){
          note.dataset.assetKind = 'image';
          renderAssetFromBlob(note, dataURLtoBlob(it.image), 'image', 'image/*', 'image');
        }

        // Asset refs (stored in IndexedDB)
        if(it.assetId){
          note.dataset.assetId = it.assetId;
          note.dataset.assetKind = it.assetKind || null;
          note.dataset.assetMime = it.assetMime || null;
          note.dataset.assetName = it.assetName || null;
        }
        if(Array.isArray(it.tags) && it.tags.length) setNoteTags(note, it.tags);
        if(Array.isArray(it.playlist) && it.playlist.length) note.dataset.playlist = JSON.stringify(it.playlist);

        board.appendChild(note);
      });
      renderLayers();
      applyTagFilter();
      // async hydrate assets
      hydrateAssets();
    };
    let pushTimer=null;
    pushHistoryDebounced = function(){
      clearTimeout(pushTimer);
      pushTimer=setTimeout(pushHistory, 200);
    };
    refreshUndoRedo = function(){
      if(undoBtn) undoBtn.disabled = !hist.canUndo();
      if(redoBtn) redoBtn.disabled = !hist.canRedo();
    };
    doUndo = function(){
      const ok = hist.undo(applyState);
      if(ok){ toast('Undo'); refreshUndoRedo(); saveState('board', exportBoard()); }
    };
    doRedo = function(){
      const ok = hist.redo(applyState);
      if(ok){ toast('Redo'); refreshUndoRedo(); saveCurrentBoard(); }
    };

    function saveCurrentBoard(){
      const snap = exportBoard();
      saveBoardData(currentBoardId, snap);
      saveConnectionsData(currentBoardId, connections);
      saveMeta(meta);
    }

    // Collect all asset IDs referenced by export payload (items + playlists)
    function collectAssetIdsFromPayload(payload){
      const ids = new Set();
      const items = (payload && payload.board && payload.board.items) || payload.items || [];
      items.forEach(it=>{
        if(it.assetId) ids.add(it.assetId);
        if(Array.isArray(it.playlist)) it.playlist.forEach(t=>{ if(t && t.assetId) ids.add(t.assetId); });
      });
      return ids;
    }

    exportBoardAsZipFn = async function(){
      if(typeof JSZip === 'undefined'){ toast('JSZip not loaded'); return; }
      const data = exportBoard();
      const boardTitle = (meta.boards.find(b=>b.id===currentBoardId)||{}).title || 'board';
      const payload = {
        format: 'BytePadStudioExport',
        version: 1,
        exportedAt: new Date().toISOString(),
        board: { id: currentBoardId, title: boardTitle, items: data.items },
        connections: connections.slice(),
        note: 'ZIP includes media. Use Open from file and select this .zip to restore.'
      };
      const zip = new JSZip();
      zip.file('export.json', JSON.stringify(payload, null, 2));
      const assetIds = collectAssetIdsFromPayload(payload);
      const metaMap = {};
      for(const id of assetIds){
        try{
          const rec = await idbGet(id);
          if(rec && rec.blob){
            zip.file('assets/' + id, rec.blob);
            metaMap[id] = { mime: rec.mime || 'application/octet-stream', name: rec.name || id };
          }
        }catch(_){}
      }
      zip.file('asset_meta.json', JSON.stringify(metaMap));
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (boardTitle.replace(/\W+/g,'-').toLowerCase()) + '-with-media.zip';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Exported ZIP with ' + assetIds.size + ' media file(s)');
    };

    importFromZipFn = async function(file){
      if(typeof JSZip === 'undefined'){ toast('JSZip not loaded'); return; }
      const arrayBuffer = await new Promise((resolve, reject)=>{
        const r = new FileReader();
        r.onload = ()=> resolve(r.result);
        r.onerror = ()=> reject(r.error);
        r.readAsArrayBuffer(file);
      });
      const zip = await JSZip.loadAsync(arrayBuffer);
      const jsonFile = zip.file('export.json');
      if(!jsonFile){ toast('ZIP has no export.json'); return; }
      const jsonText = await jsonFile.async('string');
      const data = JSON.parse(jsonText);
      const items = (data.board && data.board.items) || data.items || [];
      let metaMap = {};
      const metaFile = zip.file('asset_meta.json');
      if(metaFile){
        try{ metaMap = JSON.parse(await metaFile.async('string')); }catch(_){}
      }
      for(const it of items){
        if(it.assetId){
          const rec = metaMap[it.assetId] || {};
          const blobFile = zip.file('assets/' + it.assetId);
          if(blobFile){
            const blob = await blobFile.async('blob');
            await idbPut(it.assetId, {
              blob,
              mime: rec.mime || it.assetMime || 'application/octet-stream',
              name: rec.name || it.assetName || it.assetId,
              t: Date.now()
            });
          }
        }
        if(Array.isArray(it.playlist)){
          for(const t of it.playlist){
            if(!t || !t.assetId) continue;
            const blobFile = zip.file('assets/' + t.assetId);
            if(blobFile){
              const blob = await blobFile.async('blob');
              const rec = metaMap[t.assetId] || {};
              await idbPut(t.assetId, {
                blob,
                mime: rec.mime || 'audio/mpeg',
                name: rec.name || t.name || t.assetId,
                t: Date.now()
              });
            }
          }
        }
      }
      if(data && data.format === 'BytePadStudioExport' && data.board){
        const b = data.board;
        applyState({ items: b.items || [] });
        connections.length = 0;
        (data.connections || []).forEach(c=> addConnection(c.from, c.to, connections));
        saveCurrentBoard();
        renderConnections(board, connections, connectionsSvg);
        hydrateAssets();
        hist.push(exportBoard());
        refreshUndoRedo();
        renderLayers();
        toast('Imported ' + (b.title || 'board') + ' with media');
      } else if(data && data.items){
        applyState(data);
        saveCurrentBoard();
        hydrateAssets();
        hist.push(exportBoard());
        refreshUndoRedo();
        renderLayers();
        toast('Imported with media');
      } else {
        toast('Unknown ZIP format');
      }
    };

    function loadBoard(boardId){
      currentBoardId = boardId;
      connections = loadConnectionsData(boardId);
      const data = loadBoardData(boardId);
      if(data && Array.isArray(data.items) && data.items.length){
        applyState(data);
      } else {
        board.querySelectorAll('.note').forEach(n=>n.remove());
      }
      hist.push(exportBoard());
      refreshUndoRedo();
      renderConnections(board, connections, connectionsSvg);
      renderLayers();
      if(typeof renderBoardPicker === 'function') renderBoardPicker();
      const boardTitle = (meta.boards.find(b=>b.id===currentBoardId)||{}).title || 'Board';
      document.title = 'BytePad Studio v5 — ' + boardTitle;
    }

    pushHistory = function(){
      const snap = exportBoard();
      hist.push(snap);
      saveCurrentBoard();
      refreshUndoRedo();
      renderLayers();
      renderConnections(board, connections, connectionsSvg);
    };

    if(undoBtn) undoBtn.addEventListener('click', doUndo);
    if(redoBtn) redoBtn.addEventListener('click', doRedo);
    bindUndoRedoShortcuts(doUndo, doRedo);

    // Drag template items into board
    document.querySelectorAll('[data-template]').forEach(item=>{
      item.addEventListener('dragstart', (e)=>{
        e.dataTransfer.setData('application/json', item.getAttribute('data-template'));
      });
    });

    function renderNoteTags(noteEl){
      const wrap = noteEl.querySelector('.note-tags');
      if(!wrap) return;
      const tags = getNoteTags(noteEl);
      wrap.innerHTML = tags.map(t=> `<span class="chip tag-chip" data-tag="${escapeHtml(t)}">${escapeHtml(t)} <button type="button" class="tag-remove" aria-label="Remove tag">×</button></span>`).join('');
      wrap.querySelectorAll('.tag-remove').forEach(btn=>{
        btn.addEventListener('click', (e)=>{ e.stopPropagation(); e.preventDefault();
          const tag = btn.closest('.tag-chip').dataset.tag;
          const t = getNoteTags(noteEl).filter(x=> x !== tag);
          setNoteTags(noteEl, t);
          renderNoteTags(noteEl);
          applyTagFilter();
          pushHistoryDebounced();
        });
      });
    }

    makeNote = function(opts){
      const id = opts.id || ('n_' + Math.random().toString(16).slice(2));
      const cfg = loadConfig();
      const color = opts.color || opts.theme || cfg.defaultTheme || 'yellow';
      const x = opts.x ?? 40;
      const y = opts.y ?? 40;
      const w = opts.w ?? 220;
      const h = opts.h ?? 170;
      const title = opts.title || 'Note';
      const text  = opts.text || '';
      const tags  = Array.isArray(opts.tags) ? opts.tags : [];

      const n = document.createElement('div');
      n.className = `note ${color}`;
      n.dataset.id = id;
      n.dataset.tags = JSON.stringify(tags);
      n.style.left = x+'px';
      n.style.top  = y+'px';
      n.style.width = w+'px';
      n.style.height = h+'px';
      n.style.zIndex = String(opts.z||10);

      n.innerHTML = `
        <div class="head" title="Drag to move (or hold Alt and drag anywhere)">
          <div class="grabstrip" aria-hidden="true"></div>
          <div class="head-row">
            <strong class="title" contenteditable="true" spellcheck="false">${escapeHtml(title)}</strong>
            <div class="note-tags-wrap">
              <div class="note-tags"></div>
              <button type="button" class="iconbtn tag-add" title="Add tag">+</button>
              <input type="text" class="tag-input" placeholder="tag…" maxlength="32" style="display:none"/>
            </div>
            <span class="chip">${color}</span>
            <button class="iconbtn" title="delete">×</button>
          </div>
        </div>
        <div class="body">
          <div class="media"></div>
          <div class="body-text" contenteditable="true" spellcheck="false"></div>
        </div>
        <div class="resizer" title="resize"></div>
      `;
      n.querySelector('.body-text').innerHTML = sanitizeRichText(text);
      renderNoteTags(n);

      (function setupTagAdd(){
        const addBtn = n.querySelector('.tag-add');
        const input = n.querySelector('.tag-input');
        if(!addBtn || !input) return;
        addBtn.addEventListener('click', (e)=>{
          e.stopPropagation();
          if(input.style.display === 'none'){
            input.style.display = 'inline-block';
            input.value = '';
            input.focus();
          } else { input.style.display = 'none'; }
        });
        input.addEventListener('blur', ()=>{
          const v = (input.value||'').trim().replace(/,/g,'');
          if(v){
            const t = getNoteTags(n);
            if(!t.includes(v)){ setNoteTags(n, t.concat(v)); renderNoteTags(n); applyTagFilter(); pushHistoryDebounced(); }
          }
          input.style.display = 'none';
        });
        input.addEventListener('keydown', (e)=>{
          if(e.key==='Enter'){ input.blur(); e.preventDefault(); }
          if(e.key==='Escape'){ input.value=''; input.style.display='none'; input.blur(); }
        });
      })();

      // Group move
      (function attachDragGroup(){
        const handle = n.querySelector('.head');
        let startX=0,startY=0, leaderOX=0, leaderOY=0;
        let group=null, dragging=false;

        const onMove=(e)=>{
          if(!dragging) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;

          let x = leaderOX + dx;
          let y = leaderOY + dy;
          const out = computeSnapAndGuides(board, n, x, y, {snap:true, grid:10, tol:6});
          x = out.x; y = out.y;
          showGuides(board, out.gx, out.gy);

          const ldx = x - leaderOX;
          const ldy = y - leaderOY;
          group.forEach(g=>{
            g.node.style.left = (g.ox + ldx) + 'px';
            g.node.style.top  = (g.oy + ldy) + 'px';
          });
        };
        const onUp=()=>{
          if(!dragging) return;
          dragging=false;
          clearGuides(board);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          pushHistoryDebounced();
          renderLayers();
        };

        function startDrag(e){
          // Allow Alt-drag from anywhere, otherwise only from the head/grab area.
          const fromAny = !!e.altKey;
          const inEditable = !!e.target.closest('.body-text, .title');
          const inMedia = !!e.target.closest('.media');
          const inResizer = !!e.target.closest('.resizer');
          const inTags = !!e.target.closest('.note-tags-wrap');
          if(!fromAny && (inEditable || inMedia || inResizer || inTags)) return;

          e.preventDefault();
          dragging=true;
          bringToFront(n);
          selectToggle(board, n, e.shiftKey);

          const sel = selectedNodes(board).filter(x=>x.classList.contains('note'));
          const moving = sel.includes(n) ? sel : [n];
          group = moving.map(node=>({
            node,
            ox: parseFloat(node.style.left||'0'),
            oy: parseFloat(node.style.top||'0')
          }));

          startX=e.clientX; startY=e.clientY;
          leaderOX=parseFloat(n.style.left||'0');
          leaderOY=parseFloat(n.style.top||'0');

          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        }

        handle.addEventListener('pointerdown', startDrag);
        // Alt-drag anywhere on the note (even after it loses focus)
        n.addEventListener('pointerdown', (e)=>{ if(e.altKey) startDrag(e); });
      })();

      // Group resize
      (function attachResizeGroup(){
        const resizer = n.querySelector('.resizer');
        let startX=0,startY=0,origW=0,origH=0,resizing=false, group=null;
        const onMove=(e)=>{
          if(!resizing) return;
          const dx=e.clientX-startX;
          const dy=e.clientY-startY;
          let w = Math.max(160, origW + dx);
          let h = Math.max(120, origH + dy);
          w = Math.round(w/10)*10;
          h = Math.round(h/10)*10;
          if(group && group.length>1){
            groupResize(group, n, w, h, 160, 120);
          }else{
            n.style.width = w+'px';
            n.style.height= h+'px';
          }
        };
        const onUp=()=>{
          if(!resizing) return;
          resizing=false;
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          pushHistoryDebounced();
        };
        resizer.addEventListener('pointerdown',(e)=>{
          e.preventDefault();
          resizing=true;
          startX=e.clientX; startY=e.clientY;
          origW=n.getBoundingClientRect().width;
          origH=n.getBoundingClientRect().height;
          const sel = selectedNodes(board).filter(x=>x.classList.contains('note'));
          const moving = (sel.includes(n) ? sel : [n]);
          group = moving;
          group.forEach(node=>{
            node._origW = node.getBoundingClientRect().width;
            node._origH = node.getBoundingClientRect().height;
          });
          n._origW = origW; n._origH = origH;
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        });
      })();
      n.addEventListener('pointerdown', (e)=> {
        if(connectMode){
          const id = n.dataset.id;
          if(!connectFrom){
            connectFrom = id;
            toast('Click another note to connect');
          } else if(connectFrom !== id){
            addConnection(connectFrom, id, connections);
            connectFrom = null;
            saveConnectionsData(currentBoardId, connections);
            renderConnections(board, connections, connectionsSvg);
            toast('Connected');
          }
          return;
        }
        bringNoteToTop(n);
        selectToggle(board, n, e.shiftKey);
        renderLayers();
      });

      const body = n.querySelector('.body');
      
      // Set up input handlers
      if(body.querySelector('.body-text')){
        body.querySelector('.body-text').addEventListener('input', ()=>{
          pushHistoryDebounced();
          renderLayers();
        });
      } else {
        body.addEventListener('input', ()=>{
          pushHistoryDebounced();
          renderLayers();
        });
      }

      // Image drop on note
      body.addEventListener('dragover', (e)=>{
        e.preventDefault();
        e.stopPropagation();
        body.style.outline = '2px dashed rgba(255,79,216,.50)';
      });
      body.addEventListener('dragleave', (e)=>{
        body.style.outline = '';
      });
      body.addEventListener('drop', (e)=>{
        body.style.outline = '';
        handleImageDrop(e, n);
      });

      n.querySelector('.iconbtn').addEventListener('click', (e)=>{
        e.stopPropagation();
        const noteId = n.dataset.id;
        const assetId = n.dataset.assetId;
        deleteConnectionsForNote(noteId, connections);
        clearObjectURL(n);
        n.remove();
        if(assetId){
          idbDel(assetId).catch(()=>{});
        }
        saveConnectionsData(currentBoardId, connections);
        renderConnections(board, connections, connectionsSvg);
        pushHistoryDebounced();
        renderLayers();
        toast('Deleted');
      });

      return n;
    }

    // Board drop: note templates and image files
    enableBoardDrop(board, (obj,x,y)=>{
      if(obj.type !== 'note') return;
      const n = makeNote({ ...obj, x, y });
      bringToFront(n);
      board.appendChild(n);
      pushHistoryDebounced();
      renderLayers();
      toast('Added note');
    });

    // Drag/drop onto board: templates, rich text, and media files
    board.addEventListener('dragover', (e)=>{
      e.preventDefault();
      e.stopPropagation();
    });

    board.addEventListener('drop', (e)=>{
      const files = e.dataTransfer.files;
      const html = e.dataTransfer.getData('text/html');
      const text = e.dataTransfer.getData('text/plain');

      // Media file drop (single or multiple audio → playlist)
      if(files && files.length > 0){
        const hasMedia = Array.from(files).some(f =>
          f.type.startsWith('image/') || f.type.startsWith('audio/') || f.type.startsWith('video/')
        );
        if(hasMedia){
          e.preventDefault();
          e.stopPropagation();
          handleImageDrop(e, null);
          return;
        }
      }

      // Rich text drop (from browser/Word/etc.)
      if(html || text){
        e.preventDefault();
        const rect = board.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const content = html ? sanitizeRichText(html) : sanitizeRichText(text);
        const n = makeNote({ color: loadConfig().defaultTheme || 'yellow', title:'Drop', text: content, x, y });
        bringToFront(n);
        board.appendChild(n);
        pushHistoryDebounced();
        renderLayers();
        toast('Dropped text');
      }
    });

    document.getElementById('newNoteBtn').addEventListener('click', ()=>{
      const n = makeNote({ color: loadConfig().defaultTheme || 'yellow', title:'Note', text:'', x: 60, y: 60 });
      bringToFront(n);
      board.appendChild(n);
      pushHistoryDebounced();
      renderLayers();
      toast('New note');
    });

    document.getElementById('saveBoardBtn').addEventListener('click', ()=>{
      pushHistory();
      toast('Saved');
    });

    document.getElementById('clearBoardBtn').addEventListener('click', ()=>{
      if(confirm('Clear all notes?')){
        board.innerHTML = '';
        pushHistoryDebounced();
        renderLayers();
        toast('Cleared');
      }
    });

    // Keyboard delete supports multi-select
    window.addEventListener('keydown', (e)=>{
      if(e.key === 'Escape'){
        board.querySelectorAll('.selected').forEach(n=>n.classList.remove('selected'));
        renderLayers();
        return;
      }
      if(e.key !== 'Delete' && e.key !== 'Backspace') return;
      const sels = selectedNodes(board).filter(n=>n.classList.contains('note'));
      if(sels.length){
        sels.forEach(n=>{ deleteConnectionsForNote(n.dataset.id, connections); n.remove(); });
        saveConnectionsData(currentBoardId, connections);
        renderConnections(board, connections, connectionsSvg);
        pushHistoryDebounced();
        renderLayers();
        toast('Deleted');
      }
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e)=>{
      const inEditable = document.activeElement && document.activeElement.closest('[contenteditable="true"]');
      if(e.ctrlKey || e.metaKey){
        if(e.key === 's'){
          e.preventDefault();
          pushHistory();
          toast('Saved');
        } else if(e.key === 'n'){
          e.preventDefault();
          handleMenuAction('new');
        } else if(e.key === 'a'){
          e.preventDefault();
          handleMenuAction('selectAll');
        } else if(e.key === 'x' && !inEditable){
          e.preventDefault();
          handleMenuAction('cut');
        } else if(e.key === 'c' && !inEditable){
          const sels = selectedNodes(board).filter(n=>n.classList.contains('note'));
          if(sels.length){ e.preventDefault(); handleMenuAction('copy'); }
        } else if(e.key === 'v' && !inEditable && clipboard.length){
          e.preventDefault();
          handleMenuAction('paste');
        } else if(e.key === 'o'){
          e.preventDefault();
          handleMenuAction('open');
        } else if(e.key === 'S'){
          e.preventDefault();
          handleMenuAction('saveAsFile');
        }
      }
    });

    function toggleConnectMode(){
      connectMode = !connectMode;
      connectFrom = null;
      toast(connectMode ? 'Connect mode: click two notes' : 'Connect mode off');
    }

    // Clipboard (cut/copy/paste notes)
    let clipboard = [];
    function copyNotesToClipboard(){
      const sels = selectedNodes(board).filter(n=>n.classList.contains('note'));
      if(!sels.length){ toast('Select note(s) to copy'); return; }
      clipboard = sels.map(n=>{
        const body = n.querySelector('.body');
        const textDiv = body ? body.querySelector('.body-text') : null;
        const colorMatch = n.className.match(/\b(yellow|pink|blue|green|purple|classicYellow|whiteout|smokeSilver|blackout)\b/);
        return {
          color: colorMatch ? colorMatch[1] : (loadConfig().defaultTheme || 'yellow'),
          title: n.querySelector('.head .title')?.textContent || 'Note',
          html: textDiv ? textDiv.innerHTML : '',
          tags: getNoteTags(n),
          assetId: n.dataset.assetId || null,
          assetKind: n.dataset.assetKind || null,
          assetMime: n.dataset.assetMime || null,
          assetName: n.dataset.assetName || null,
          playlist: n.dataset.playlist ? (function(){ try{ return JSON.parse(n.dataset.playlist); }catch(_){ return null; }})() : null,
          w: parseFloat(n.style.width||'220'),
          h: parseFloat(n.style.height||'170')
        };
      });
      toast('Copied ' + clipboard.length + ' note(s)');
    }
    function cutNotesToClipboard(){
      copyNotesToClipboard();
      const sels = selectedNodes(board).filter(n=>n.classList.contains('note'));
      sels.forEach(n=>{
        deleteConnectionsForNote(n.dataset.id, connections);
        n.remove();
      });
      saveConnectionsData(currentBoardId, connections);
      renderConnections(board, connections, connectionsSvg);
      pushHistoryDebounced();
      renderLayers();
      toast('Cut ' + clipboard.length + ' note(s)');
    }
    function pasteNotesFromClipboard(offsetX, offsetY){
      if(!clipboard.length){ toast('Clipboard empty'); return; }
      const br = board.getBoundingClientRect();
      let x = offsetX != null ? offsetX : board.scrollLeft + (board.clientWidth/2) - 120;
      let y = offsetY != null ? offsetY : board.scrollTop + (board.clientHeight/2) - 80;
      clipboard.forEach((it, i)=>{
        const note = makeNote({
          color: it.color,
          title: it.title,
          text: it.html || '',
          tags: Array.isArray(it.tags) ? it.tags : [],
          x: x + i * 24,
          y: y + i * 24,
          w: it.w || 220,
          h: it.h || 170
        });
        if(it.assetId){
          note.dataset.assetId = it.assetId;
          note.dataset.assetKind = it.assetKind || null;
          note.dataset.assetMime = it.assetMime || null;
          note.dataset.assetName = it.assetName || null;
          if(Array.isArray(it.playlist) && it.playlist.length) note.dataset.playlist = JSON.stringify(it.playlist);
          hydrateAssets();
        }
        board.appendChild(note);
        bringToFront(note);
      });
      pushHistoryDebounced();
      renderLayers();
      renderConnections(board, connections, connectionsSvg);
      toast('Pasted ' + clipboard.length + ' note(s)');
    }

    // Board picker
    function renderBoardPicker(){
      const sel = document.getElementById('boardSelect');
      if(!sel) return;
      sel.innerHTML = '';
      meta.boards.forEach(b=>{
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.title;
        if(b.id === currentBoardId) opt.selected = true;
        sel.appendChild(opt);
      });
    }
    function setupBoardPicker(){
      const sel = document.getElementById('boardSelect');
      const btnNew = document.getElementById('btnNewBoard');
      const btnRename = document.getElementById('btnRenameBoard');
      if(sel){
        sel.addEventListener('change', ()=>{
          const id = sel.value;
          if(id && id !== currentBoardId){
            saveCurrentBoard();
            loadBoard(id);
          }
        });
      }
      if(btnNew){
        btnNew.addEventListener('click', ()=>{
          const title = prompt('New board name', 'Board ' + (meta.boards.length + 1));
          if(!title) return;
          const id = 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
          meta.boards.push({ id, title });
          saveMeta(meta);
          loadBoard(id);
          renderBoardPicker();
          toast('Created: ' + title);
        });
      }
      if(btnRename){
        btnRename.addEventListener('click', ()=>{
          const b = meta.boards.find(x=>x.id === currentBoardId);
          if(!b) return;
          const title = prompt('Rename board', b.title);
          if(!title) return;
          b.title = title;
          saveMeta(meta);
          renderBoardPicker();
          toast('Renamed');
        });
      }
    }

    // Command palette
    function buildCommands(){
      const list = [
        { id: 'new_note', label: 'New note', hint: 'Add a note' },
        { id: 'search_tag', label: 'Search by tag', hint: 'Focus tag search in board bar' },
        { id: 'toggle_connect', label: 'Toggle connect mode', hint: 'Click two notes to connect' },
        { id: 'export_board', label: 'Export board', hint: 'BytePadStudioExport JSON' },
        { id: 'export_zip', label: 'Export as ZIP with media', hint: 'Board + images/audio/video in one file' },
        { id: 'cleanup_assets', label: 'Cleanup unused media', hint: 'Remove orphaned assets from IndexedDB' },
        { id: 'settings', label: 'Open Settings', hint: 'Theme, backup, storage' }
      ];
      meta.boards.forEach(b=>{
        list.push({ id: 'switch:' + b.id, label: 'Switch to: ' + b.title, hint: 'Change board' });
      });
      return list;
    }
    function openPalette(){
      const pal = document.getElementById('commandPalette');
      const listEl = document.getElementById('paletteList');
      const inputEl = document.getElementById('paletteInput');
      if(!pal || !listEl || !inputEl) return;
      pal.setAttribute('aria-hidden', 'false');
      inputEl.value = '';
      inputEl.focus();
      const cmds = buildCommands();
      listEl.innerHTML = cmds.map((c,i)=>'<div class="command-palette-item" data-cmd="'+ c.id.replace(/"/g,'&quot;') +'" data-index="'+i+'">'+ escapeHtml(c.label) +' <span class="muted" style="font-size:11px">'+ escapeHtml(c.hint||'') +'</span></div>').join('');
      listEl.querySelectorAll('.command-palette-item').forEach((el,i)=>{
        el.classList.toggle('active', i===0);
        el.addEventListener('click', ()=>{
          runCommand(el.dataset.cmd);
          closePalette();
        });
      });
      function filter(){
        const q = (inputEl.value||'').trim().toLowerCase();
        const filtered = q ? buildCommands().filter(c=>(c.label+c.hint).toLowerCase().includes(q)) : buildCommands();
        listEl.innerHTML = filtered.map((c,i)=>'<div class="command-palette-item" data-cmd="'+ c.id.replace(/"/g,'&quot;') +'" data-index="'+i+'">'+ escapeHtml(c.label) +' <span class="muted" style="font-size:11px">'+ escapeHtml(c.hint||'') +'</span></div>').join('');
        listEl.querySelectorAll('.command-palette-item').forEach((el,i)=>{
          el.classList.toggle('active', i===0);
          el.addEventListener('click', ()=>{ runCommand(el.dataset.cmd); closePalette(); });
        });
      }
      inputEl.addEventListener('input', filter);
      inputEl.onkeydown = (e)=>{
        if(e.key==='Escape'){ closePalette(); return; }
        if(e.key==='Enter'){
          const active = listEl.querySelector('.command-palette-item.active');
          if(active){ runCommand(active.dataset.cmd); closePalette(); }
          return;
        }
        if(e.key==='ArrowDown' || e.key==='ArrowUp'){
          e.preventDefault();
          const items = listEl.querySelectorAll('.command-palette-item');
          let idx = [...items].findIndex(it=>it.classList.contains('active'));
          if(e.key==='ArrowDown') idx = Math.min(idx+1, items.length-1);
          else idx = Math.max(idx-1, 0);
          items.forEach((it,i)=> it.classList.toggle('active', i===idx));
        }
      };
    }
    function closePalette(){
      const pal = document.getElementById('commandPalette');
      if(pal) pal.setAttribute('aria-hidden', 'true');
    }
    function runCommand(id){
      if(id==='new_note'){
        const n = makeNote({ color: loadConfig().defaultTheme || 'yellow', title: 'Note', text: '', x: 60, y: 60 });
        bringToFront(n);
        board.appendChild(n);
        pushHistoryDebounced();
        renderLayers();
        renderConnections(board, connections, connectionsSvg);
        toast('New note');
      } else if(id==='search_tag'){
        closePalette();
        const el = document.getElementById('tagSearchInput');
        if(el){ el.focus(); el.select(); }
      } else if(id==='toggle_connect') toggleConnectMode();
      else if(id==='export_board') handleMenuAction('export');
      else if(id==='export_zip') handleMenuAction('exportZip');
      else if(id==='cleanup_assets') cleanupUnusedAssets();
      else if(id==='settings') openSettingsPanel();
      else if(id && id.startsWith('switch:')){
        const bid = id.slice(7);
        if(bid && bid !== currentBoardId){ saveCurrentBoard(); loadBoard(bid); }
      }
    }
    document.addEventListener('keydown', (e)=>{
      if((e.ctrlKey||e.metaKey) && e.key==='k'){ e.preventDefault(); openPalette(); }
    });
    const btnPalette = document.getElementById('btnCommandPalette');
    if(btnPalette) btnPalette.addEventListener('click', openPalette);

    // Cleanup unused media (IndexedDB)
    async function cleanupUnusedAssets(){
      const refs = new Set();
      board.querySelectorAll('.note[data-asset-id]').forEach(n=>{
        if(n.dataset.assetId) refs.add(n.dataset.assetId);
        const pl = getPlaylist(n);
        if(pl) pl.forEach(t=>{ if(t.assetId) refs.add(t.assetId); });
      });
      const keys = await idbGetAllKeys();
      const unused = keys.filter(k=>!refs.has(k));
      if(!unused.length){ toast('No unused assets'); return; }
      if(!confirm('Delete ' + unused.length + ' unused media file(s) from this device?')) return;
      for(const k of unused) await idbDel(k);
      toast('Removed ' + unused.length + ' unused assets');
    }

    // Settings panel
    function openSettingsPanel(){
      const panel = document.getElementById('settingsPanel');
      const overlay = document.getElementById('settingsOverlay');
      if(panel) panel.classList.add('visible');
      if(overlay) overlay.setAttribute('aria-hidden', 'false');
      const cfg = loadConfig();
      const sel = document.getElementById('defaultThemeSelect');
      if(sel) sel.value = cfg.defaultTheme || 'yellow';
      const storageEl = document.getElementById('storageInfo');
      if(storageEl){
        let total = 0;
        try{
          for(let i=0;i<localStorage.length;i++){
            const k = localStorage.key(i);
            if(k) total += (localStorage.getItem(k)||'').length;
          }
        }catch(_){}
        storageEl.textContent = 'localStorage: ~' + (total >> 10) + ' KB';
      }
    }
    function closeSettingsPanel(){
      const panel = document.getElementById('settingsPanel');
      const overlay = document.getElementById('settingsOverlay');
      if(panel) panel.classList.remove('visible');
      if(overlay) overlay.setAttribute('aria-hidden', 'true');
    }
    document.getElementById('settingsClose')?.addEventListener('click', closeSettingsPanel);
    document.getElementById('settingsOverlay')?.addEventListener('click', closeSettingsPanel);
    document.getElementById('defaultThemeSelect')?.addEventListener('change', (e)=>{
      const cfg = loadConfig();
      cfg.defaultTheme = e.target.value;
      saveConfig(cfg);
      const label = e.target.options[e.target.selectedIndex].text;
      toast('Default theme: ' + label + ' (new notes)');
    });
    document.getElementById('settingsExport')?.addEventListener('click', ()=>{ handleMenuAction('export'); });
    document.getElementById('settingsImport')?.addEventListener('click', ()=>{ handleMenuAction('import'); });
    document.getElementById('btnSettings')?.addEventListener('click', openSettingsPanel);

    // Init: load current board
    loadBoard(meta.currentBoardId);
    renderBoardPicker();
    setupBoardPicker();

    // Tag search (internal)
    const tagSearchInput = document.getElementById('tagSearchInput');
    const tagSearchClear = document.getElementById('tagSearchClear');
    if(tagSearchInput){
      tagSearchInput.addEventListener('input', applyTagFilter);
      tagSearchInput.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ tagSearchInput.value=''; applyTagFilter(); tagSearchInput.blur(); } });
    }
    if(tagSearchClear){
      tagSearchClear.addEventListener('click', ()=>{ if(tagSearchInput) tagSearchInput.value=''; applyTagFilter(); tagSearchInput?.focus(); });
    }

    // Initialize dock windows and menu bar
    enableDockWindows();
    initMenuBar();
    initAboutModal();

    // Enable context menus
    // Board context menu
    enableContextMenu(board, (e) => {
      const note = e.target.closest('.note');
      if(note){
        const items = [
          { label: 'Cut', shortcut: 'Ctrl+X', action: () => { cutNotesToClipboard(); }},
          { label: 'Copy', shortcut: 'Ctrl+C', action: () => { copyNotesToClipboard(); }},
          { label: 'Duplicate', action: () => {
            const rect = note.getBoundingClientRect();
            const boardRect = board.getBoundingClientRect();
            const colorMatch = note.className.match(/\b(yellow|pink|blue|green|purple|classicYellow|whiteout|smokeSilver|blackout)\b/);
            const newNote = makeNote({
              id: 'n_' + Math.random().toString(16).slice(2),
              color: colorMatch ? colorMatch[1] : (loadConfig().defaultTheme || 'yellow'),
              title: note.querySelector('.head .title')?.textContent || 'Note',
              text: note.querySelector('.body-text')?.textContent || note.querySelector('.body')?.textContent || '',
              image: note.querySelector('.body img')?.src || null,
              x: parseFloat(note.style.left||'0') + 20,
              y: parseFloat(note.style.top||'0') + 20,
              w: parseFloat(note.style.width||'220'),
              h: parseFloat(note.style.height||'170'),
              z: parseInt(note.style.zIndex||'0',10) + 1
            });
            if(note.querySelector('.body img')){
              const img = document.createElement('img');
              img.src = note.querySelector('.body img').src;
              img.style.width = '100%';
              img.style.height = '100%';
              img.style.objectFit = 'cover';
              const body = newNote.querySelector('.body');
              const textDiv = body.querySelector('.body-text');
              if(textDiv){
                body.innerHTML = '';
                body.appendChild(img);
                body.appendChild(textDiv);
                newNote.classList.add('has-image');
              }
            }
            bringToFront(newNote);
            board.appendChild(newNote);
            pushHistoryDebounced();
            renderLayers();
            toast('Duplicated');
          }},
          '---',
          { label: 'Delete', shortcut: 'Del', action: () => {
            note.remove();
            pushHistoryDebounced();
            renderLayers();
            toast('Deleted');
          }},
          '---',
          { label: 'Remove Image', disabled: !note.classList.contains('has-image'), action: () => {
            const body = note.querySelector('.body');
            const img = body.querySelector('img');
            const textDiv = body.querySelector('.body-text');
            if(img){
              img.remove();
              note.classList.remove('has-image');
              if(textDiv){
                body.innerHTML = '';
                body.contentEditable = 'true';
                body.textContent = textDiv.textContent;
                body.addEventListener('input', ()=>{
                  pushHistoryDebounced();
                  renderLayers();
                });
              }
              pushHistoryDebounced();
              renderLayers();
              toast('Image removed');
            }
          }},
          { label: 'Bring to Front', action: () => {
            bringToFront(note);
            pushHistoryDebounced();
            renderLayers();
            toast('Brought to front');
          }}
        ];
        return items;
      }
      // Empty board context menu
      const boardRect = board.getBoundingClientRect();
      const pasteX = e.clientX - boardRect.left + board.scrollLeft;
      const pasteY = e.clientY - boardRect.top + board.scrollTop;
      return [
        { label: 'Paste', shortcut: 'Ctrl+V', action: () => { pasteNotesFromClipboard(pasteX, pasteY); }},
        '---',
        { label: 'New Note', shortcut: 'Ctrl+N', action: () => {
          const x = e.clientX - boardRect.left + board.scrollLeft;
          const y = e.clientY - boardRect.top + board.scrollTop;
          const n = makeNote({ color: loadConfig().defaultTheme || 'yellow', title:'Note', text:'', x, y });
          bringToFront(n);
          board.appendChild(n);
          pushHistoryDebounced();
          renderLayers();
          toast('New note');
        }}
      ];
    });

    // Templates list context menu
    const templatesList = document.getElementById('templatesList');
    if(templatesList){
      enableContextMenu(templatesList, (e) => {
        const item = e.target.closest('.item');
        if(!item) return [];
        
        return [
          { label: 'Add to Canvas', action: () => {
            const data = item.getAttribute('data-template');
            if(data){
              try{
                const obj = JSON.parse(data);
                const rect = board.getBoundingClientRect();
                const n = makeNote({ ...obj, x: 200, y: 200 });
                bringToFront(n);
                board.appendChild(n);
                pushHistoryDebounced();
                renderLayers();
                toast('Added');
              }catch(e){}
            }
          }}
        ];
      });
    }
  });
})();
