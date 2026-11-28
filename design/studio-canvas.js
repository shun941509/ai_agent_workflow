(() => {
  'use strict';
  const SVG = 'http://www.w3.org/2000/svg';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const point = (x, y) => ({ x, y });
  const kinds = {
    input: ['#deebff','#326dc9','M13 3H6v5m0 10v3h12V8l-5-5v5h5M2 13h10m-4-4 4 4-4 4'],
    agent: ['#cff0e9','#00746b','M7 7h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm5 0V3m-2 0h2M2 11v4m20-4v4m-13-3v2m6-2v2'],
    output: ['#fff0c9','#a9650a','M8 3h7l4 4v14H8v-4m6-14v5h5M2 13h11m-7-4-4 4 4 4'],
    resource: ['#eee1ff','#8646d4','M3 7c0-4 18-4 18 0s-18 4-18 0Zm0 0v10c0 4 18 4 18 0V7M3 12c0 4 18 4 18 0'],
    condition: ['#fff0c9','#b46511','M12 7v3M5 17v-3l7-4 7 4v3M9 4l3-2 3 2-3 3-3-3ZM3 17h4v4H3zm14 0h4v4h-4z'],
    start: ['#d6f3dd','#278348','M6 3l14 9-14 9z'],
    end: ['#ffe0e5','#cd4966','M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z'],
    review: ['#deebff','#326dc9','M12 2l8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5l8-3Zm-4 9 3 3 5-6']
  };
  const labelKind = { flow:'진행', data:'데이터', reference:'참조' };
  let uid = 0;

  function element(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }
  function vector(tag, attributes) {
    const node = document.createElementNS(SVG, tag);
    Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
    return node;
  }
  function icon(kind) {
    const [bg, ink, path] = kinds[kind] || kinds.agent;
    const container = element('span','sc-icon');
    container.setAttribute('aria-hidden','true');
    container.style.setProperty('--icon-bg',bg);
    container.style.setProperty('--icon-ink',ink);
    const svg = vector('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.65,'stroke-linecap':'round','stroke-linejoin':'round'});
    svg.append(vector('path',{d:path}));
    container.append(svg);
    return container;
  }
  // Trim both legs of each corner to form a rounded orthogonal connection.
  function roundedLine(rawPoints, radius) {
    const points = rawPoints.filter((p,i) => !i || p.x !== rawPoints[i-1].x || p.y !== rawPoints[i-1].y);
    if (points.length < 2) return '';
    let path = 'M '+points[0].x+' '+points[0].y;
    for(let i=1;i<points.length-1;i++) {
      const [a,b,c] = points.slice(i-1,i+2);
      const incoming = Math.hypot(a.x-b.x,a.y-b.y);
      const outgoing = Math.hypot(c.x-b.x,c.y-b.y);
      const r = Math.min(radius,incoming/2,outgoing/2);
      path += ' L '+(b.x+(a.x-b.x)*r/incoming)+' '+(b.y+(a.y-b.y)*r/incoming);
      path += ' Q '+b.x+' '+b.y+' '+(b.x+(c.x-b.x)*r/outgoing)+' '+(b.y+(c.y-b.y)*r/outgoing);
    }
    return path+' L '+points.at(-1).x+' '+points.at(-1).y;
  }
  function anchor(rect, side) {
    switch(side) {
      case 'w': return point(rect.x,rect.y+rect.h/2);
      case 'n': return point(rect.x+rect.w/2,rect.y);
      case 's': return point(rect.x+rect.w/2,rect.y+rect.h);
      default: return point(rect.x+rect.w,rect.y+rect.h/2);
    }
  }
  function route(a,b,edge,variant) {
    const right = anchor(a,'e'), left = anchor(b,'w');
    if (a===b) {
      const top = anchor(b,'n');
      return [right,point(right.x+30,right.y),point(right.x+30,top.y-25),point(top.x,top.y-25),top];
    }
    if (variant==='b' && edge.kind==='reference') {
      const start = anchor(a,'n'), end = left;
      if (start.y>end.y && start.x<end.x) return [start,point(start.x,end.y),end];
    }
    if (right.x+4 < b.x+b.w/2 && b.y > right.y+15 && variant==='b') {
      const end = anchor(b,'n');
      return [right,point(end.x,right.y),end];
    }
    if (b.x>=right.x+12) {
      const middle = (right.x+left.x)/2;
      return [right,point(middle,right.y),point(middle,left.y),left];
    }
    const gap = 23;
    let corridorY = Math.min(a.y,b.y)-gap;
    if (a.y>=b.y+b.h+16) corridorY = (b.y+b.h+a.y)/2;
    if (b.y>=a.y+a.h+16) corridorY = (a.y+a.h+b.y)/2;
    return [right,point(right.x+gap,right.y),point(right.x+gap,corridorY),point(left.x-gap,corridorY),point(left.x-gap,left.y),left];
  }
  function initialRects(nodes,variant) {
    const a = variant==='a';
    const size = a ? {w:182,h:75} : {w:166,h:90};
    const slots = a ? {
      input: [0,0], agent:[246,0], output:[492,0], resource:[246,156]
    } : {
      input:[0,0], agent:[206,144], output:[402,310], resource:[5,285]
    };
    const used = new Set();
    let extra=0;
    const rects = new Map();
    for(const node of nodes) {
      let xy=slots[node.kind];
      if(!xy || used.has(node.kind)) {
        xy = [(extra%3)*(a?246:202),(a?312:475)+Math.floor(extra/3)*(a?156:140)];
        extra++;
      }
      used.add(node.kind);
      rects.set(node.id,{x:xy[0],y:xy[1],...size});
    }
    return rects;
  }
  function mount(root, options={}) {
    const unique='sc-'+(++uid)+'-';
    const select = options.onSelect || (()=>{});
    const canvas=element('div','sc-canvas');
    canvas.setAttribute('aria-label','Workflow 그래프');
    const world=element('div','sc-world');
    const wires=vector('svg',{class:'sc-wire-layer','aria-label':'Workflow 연결'});
    world.append(wires);
    const mini=element('div','sc-minimap');
    mini.setAttribute('aria-hidden','true');
    const zoomTools=element('div','sc-zoom');
    const zoomButtons={};
    const percent=element('output');
    const status=element('div','sc-status');
    const list=element('section','sc-list');
    list.setAttribute('aria-label','블록과 연결 목록');
    let state={variant:'b',nodes:[],edges:[],selected:null};
    let rects=new Map(), override={a:new Map(),b:new Map()};
    let pan=point(0,0), scale=1, gesture, inList=false, structure='', dims='';
    const nodeViews=new Map();
    function control(action,title,content,handler) {
      const b=element('button','',content);
      b.type='button'; b.dataset.action=action; b.title=title; b.setAttribute('aria-label',title);
      b.addEventListener('click',handler);
      zoomTools.append(b);zoomButtons[action]=b;
    }
    control('zoom-in','확대','+',()=>zoom(.15));
    control('zoom-out','축소','−',()=>zoom(-.15));
    zoomTools.append(percent);
    control('fit','화면에 맞추기','⛶',fit);
    canvas.append(world,mini,zoomTools,status,list);
    root.replaceChildren(canvas);
    function bounds() {
      if(!rects.size) return {x:0,y:0,w:400,h:230};
      const values=[...rects.values()];
      const x=Math.min(...values.map(r=>r.x)),y=Math.min(...values.map(r=>r.y));
      return {x,y,w:Math.max(...values.map(r=>r.x+r.w))-x,h:Math.max(...values.map(r=>r.y+r.h))-y};
    }
    function updateTransform() {
      world.style.transform='translate('+pan.x+'px,'+pan.y+'px) scale('+scale+')';
      percent.textContent=Math.round(scale*100)+'%';
      zoomTools.setAttribute('aria-label','캔버스 배율 '+percent.textContent);
      zoomButtons['zoom-in'].disabled=scale>=2.4;
      zoomButtons['zoom-out'].disabled=scale<=.25;
    }
    function fit() {
      const width=canvas.clientWidth, height=canvas.clientHeight;
      if(!width || !height) return;
      const b=bounds(), padding=width<440?13:Math.max(23,width*.075);
      scale=clamp(Math.min((width-2*padding)/b.w,(height-76)/b.h,1),.25,2.4);
      pan=point((width-b.w*scale)/2-b.x*scale,(height-b.h*scale)/2-b.y*scale);
      updateTransform();
    }
    function zoom(delta,focus=point(canvas.clientWidth/2,canvas.clientHeight/2)) {
      const next=clamp(scale+delta,.25,2.4);
      pan=point(focus.x-(focus.x-pan.x)*next/scale,focus.y-(focus.y-pan.y)*next/scale);
      scale=next;updateTransform();
    }
    function drawMini() {
      const b=bounds();
      const svg=vector('svg',{viewBox:[b.x-45,b.y-60,b.w+90,b.h+120].join(' ')});
      for(const r of rects.values()) svg.append(vector('rect',{x:r.x,y:r.y,width:r.w,height:r.h,rx:3,fill:'#b7d8cf'}));
      mini.replaceChildren(svg);
    }
    function titleOf(id) { return state.nodes.find(n=>n.id===id)?.title || id; }
    function selected(kind,id) {return state.selected?.kind===kind && state.selected.id===id;}
    function drawEdges() {
      const defs=vector('defs',{});
      const svgNodes=[defs];
      const addMarker=(color,index)=>{
        const id=unique+'arrow-'+index;
        const marker=vector('marker',{id,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto',markerUnits:'strokeWidth'});
        marker.append(vector('path',{d:'M 0 0 L 9 5 L 0 10 L 2.8 5 Z',fill:color}));
        defs.append(marker); return 'url(#'+id+')';
      };
      for(const [i,edge] of state.edges.entries()) {
        const a=rects.get(edge.from), b=rects.get(edge.to);
        if(!a || !b) continue;
        const isChosen=selected('edge',edge.id), incoming=selected('node',edge.to),outgoing=selected('node',edge.from);
        let color='#475d65',dash='';
        if(state.variant==='b'){
          if(edge.kind==='data'){color='#008c80';dash='6 5';}
          if(edge.kind==='reference'){color='#8651d2';dash='1.8 4.5';}
        }else if (incoming || outgoing) {
          color=outgoing?'#a65412':edge.kind==='reference'?'#087e9b':'#17529a';
        }
        const path=roundedLine(route(a,b,edge,state.variant),state.variant==='a'?5:13);
        const group=vector('g',{class:'sc-line',tabindex:0,role:'button','data-edge-id':edge.id,'aria-pressed':isChosen,'aria-label':titleOf(edge.from)+' → '+titleOf(edge.to)+' · '+(edge.label||labelKind[edge.kind]||'연결')});
        group.append(vector('title',{}));
        group.firstChild.textContent=group.getAttribute('aria-label');
        if(isChosen) group.append(vector('path',{d:path,stroke:'#20a59944','stroke-width':8,class:'sc-ink'}));
        const thickness=state.variant==='a' && (incoming||outgoing) ? 2.65 : 2;
        const ink=vector('path',{class:'sc-ink',d:path,stroke:color,'stroke-width':thickness,'marker-end':addMarker(color,i)});
        if(dash) ink.setAttribute('stroke-dasharray',dash);
        group.append(ink,vector('path',{class:'sc-hit',d:path}));
        svgNodes.push(group);
      }
      wires.replaceChildren(...svgNodes);
    }
    function drawNode(node) {
      const r=rects.get(node.id);
      const button=element('button','sc-node');
      button.type='button';button.dataset.nodeId=node.id;
      button.setAttribute('aria-pressed',String(selected('node',node.id)));
      button.setAttribute('aria-label',node.title+' 블록 속성');
      Object.assign(button.style,{width:r.w+'px',height:r.h+'px',left:r.x+'px',top:r.y+'px'});
      const info=element('span','sc-node-text');
      info.append(element('strong','sc-node-name',node.title),element('span','sc-node-detail',node.description || ''));
      button.append(icon(node.kind),info);
      for(const side of ['w','n','e','s'])button.append(element('i','sc-port '+side));
      world.append(button);nodeViews.set(node.id,button);
    }
    function drawStatus() {
      status.replaceChildren();
      if(state.variant==='b'){
        for(const [kind,text] of Object.entries(labelKind)){
          const item=element('span','sc-legend-item');item.append(element('i','sc-swatch '+kind),document.createTextNode(text));status.append(item);
        }
      } else if(state.selected?.kind==='node'){
        const id=state.selected.id;
        status.append(element('span','sc-in','들어옴 '+state.edges.filter(e=>e.to===id).length),element('span','sc-out','나감 '+state.edges.filter(e=>e.from===id).length));
      }
    }
    function drawList() {
      list.hidden=!inList; world.hidden=inList;mini.hidden=inList;zoomTools.hidden=inList;status.hidden=inList;
      if(!inList)return;
      list.replaceChildren(element('h3','','블록'));
      for(const node of state.nodes){
        const b=element('button');b.type='button';b.dataset.nodeId=node.id;
        b.setAttribute('aria-pressed',String(selected('node',node.id)));
        const text=element('span','',node.title);text.append(element('small','',node.description));
        b.append(icon(node.kind),text);list.append(b);
      }
      list.append(element('h3','','연결'));
      for(const e of state.edges){
        const b=element('button');b.type='button';b.dataset.edgeId=e.id;
        b.setAttribute('aria-pressed',String(selected('edge',e.id)));
        const text=element('span','',titleOf(e.from)+' → '+titleOf(e.to));text.append(element('small','',e.label||labelKind[e.kind]));b.append(text);list.append(b);
      }
    }
    function render(next) {
      const nextStructure=JSON.stringify([next.variant,next.nodes.map(n=>[n.id,n.kind])]);
      const changed=nextStructure!==structure;
      const active=document.activeElement;
      const focus=canvas.contains(active)?{node:active.dataset.nodeId,edge:active.dataset.edgeId}:null;
      state=next;
      canvas.dataset.variant=state.variant;
      const positions=Object.entries(next.layout?.[state.variant]||{}).filter(([,p])=>p && Number.isFinite(p.x) && Number.isFinite(p.y));
      override[state.variant]=new Map(positions.map(([id,p])=>[id,point(p.x,p.y)]));
      rects=initialRects(state.nodes,state.variant);
      for(const [id,p] of override[state.variant]){
        const r=rects.get(id);
        if(r)Object.assign(r,p);else override[state.variant].delete(id);
      }
      for(const b of nodeViews.values())b.remove();nodeViews.clear();
      state.nodes.forEach(drawNode);
      drawEdges();drawMini();drawStatus();drawList();
      if(changed)fit();
      structure=nextStructure;
      if(focus && (focus.node || focus.edge)){
        const scope=inList?list:world;
        const candidates=scope.querySelectorAll(focus.node?'[data-node-id]':'[data-edge-id]');
        const match=[...candidates].find(n=>focus.node?n.dataset.nodeId===focus.node:n.dataset.edgeId===focus.edge);
        match?.focus({preventScroll:true});
      }
    }
    function arrange() {
      override[state.variant].clear();
      if(state.layout) state={...state,layout:{...state.layout,[state.variant]:{}}};
      render(state);fit();options.onLayoutChange?.(state.variant,{});
    }
    function toggleList() {
      inList=!inList;drawList();
      if(!inList)fit();
      return inList;
    }
    function clickSelect(target) {
      const node=target.closest('[data-node-id]'),edge=target.closest('[data-edge-id]');
      if(node)select('node',node.dataset.nodeId);
      else if(edge)select('edge',edge.dataset.edgeId);
    }
    // Keep the pointer capture on the enduring canvas while nodes and edges are rendered.
    let suppressClick=false;
    canvas.addEventListener('pointerdown',e=>{
      suppressClick=false;
      if(e.button!==0 || inList || e.target.closest('.sc-zoom,.sc-line'))return;
      const node=e.target.closest('.sc-node');
      const id=node?.dataset.nodeId;
      const r=rects.get(id);
      gesture={pointer:e.pointerId,id,x:e.clientX,y:e.clientY,origin:r?point(r.x,r.y):{...pan},moved:false};
    });
    canvas.addEventListener('pointermove',e=>{
      if(gesture?.pointer!==e.pointerId)return;
      const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
      if(!gesture.moved && Math.hypot(dx,dy)<4)return;
      if(!gesture.moved)canvas.setPointerCapture(e.pointerId);
      gesture.moved=true;
      if(!gesture.id){pan=point(gesture.origin.x+dx,gesture.origin.y+dy);updateTransform();return;}
      const r=rects.get(gesture.id);
      if(!r)return;
      r.x=gesture.origin.x+dx/scale;r.y=gesture.origin.y+dy/scale;
      const button=nodeViews.get(gesture.id);
      button.style.left=r.x+'px';button.style.top=r.y+'px';
      override[state.variant].set(gesture.id,point(r.x,r.y));drawEdges();drawMini();
    });
    function stopPointer(e) {
      if(gesture?.pointer!==e.pointerId)return;
      const {id,moved}=gesture;
      gesture=null;
      if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
      if(moved){
        suppressClick=true;
        if(id){
          const positions=Object.fromEntries(override[state.variant]);
          if(state.layout)state={...state,layout:{...state.layout,[state.variant]:positions}};
          options.onLayoutChange?.(state.variant,positions);
        }
      }
    }
    canvas.addEventListener('pointerup',stopPointer);
    canvas.addEventListener('pointercancel',stopPointer);
    canvas.addEventListener('pointerleave',e=>{if(gesture && !gesture.moved)stopPointer(e);});
    canvas.addEventListener('click',e=>{
      if(suppressClick){suppressClick=false;return;}
      if(e.target===canvas || e.target===world){select(null,null);return;}
      clickSelect(e.target);
    });
    canvas.addEventListener('keydown',e=>{
      if(e.target.matches('.sc-line') && (e.key==='Enter'||e.key===' ')){e.preventDefault();clickSelect(e.target);}
    });
    canvas.addEventListener('wheel',e=>{
      if(inList || !e.ctrlKey)return;
      e.preventDefault();const b=canvas.getBoundingClientRect();
      zoom(e.deltaY<0?.1:-.1,point(e.clientX-b.left,e.clientY-b.top));
    },{passive:false});
    const observer=new ResizeObserver(()=>{
      const size=canvas.clientWidth+'x'+canvas.clientHeight;
      if(size!==dims){dims=size;render(state);fit();}
    });
    observer.observe(canvas);
    drawList();
    return {render,zoom,fit,arrange,toggleList};
  }
  window.StudioCanvas={mount};
})();
