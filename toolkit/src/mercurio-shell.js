import './mercurio-shell.css';

// Mercurio's palette and explorer interaction, over the existing Toolkit state.
export function createMercurioShell({monaco, files, openFile, newFile}) {
  monaco.editor.defineTheme("mercurio-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "99613f" },
      { token: "comment", foreground: "8b969e", fontStyle: "italic" },
      { token: "string", foreground: "71894a" },
      { token: "number", foreground: "9271a2" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#3c4654",
      "editorLineNumber.foreground": "#b2b8c0",
      "editorLineNumber.activeForeground": "#657b97",
      "editor.lineHighlightBackground": "#f5f7fa",
      "editor.selectionBackground": "#dce7f4",
      "editorIndentGuide.background1": "#edf0f3",
      "editorCursor.foreground": "#d97551",
      "editorWidget.background": "#fafbfc",
      "editorGutter.background": "#ffffff",
    },
  });
  monaco.editor.defineTheme("mercurio-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "d5a880" },
      { token: "comment", foreground: "747f8c", fontStyle: "italic" },
      { token: "string", foreground: "a7bc86" },
      { token: "number", foreground: "bd9ccf" },
    ],
    colors: {
      "editor.background": "#242830",
      "editor.foreground": "#d0d5dc",
      "editorLineNumber.foreground": "#555f6e",
      "editorLineNumber.activeForeground": "#b2c0d2",
      "editor.lineHighlightBackground": "#2a2f39",
      "editor.selectionBackground": "#3b4d65",
      "editorIndentGuide.background1": "#323842",
      "editorGutter.background": "#242830",
    },
  });
  let theme='light';
  try {theme=localStorage.getItem('intersect.toolkit.theme')==='dark'?'dark':'light';} catch {}
  const toggle=document.createElement('button');toggle.id='theme';toggle.className='theme-toggle';toggle.title='Switch color theme';
  toggle.setAttribute('aria-label','Switch color theme');
  const apply=()=>{document.documentElement.dataset.theme=theme;monaco.editor.setTheme('mercurio-'+theme);toggle.textContent=theme==='light'?'☾':'☀';toggle.setAttribute('aria-pressed',String(theme==='dark'));};
  toggle.onclick=()=>{theme=theme==='light'?'dark':'light';try{localStorage.setItem('intersect.toolkit.theme',theme);}catch{} apply();};
  document.querySelector('.topbar').append(toggle);apply();
  const sidebars=[];let selected='model';
  const menu=document.createElement('div');menu.id='explorer-context-menu';menu.className='explorer-context-menu';menu.hidden=true;menu.setAttribute('role','menu');
  const add=document.createElement('button');add.type='button';add.setAttribute('role','menuitem');add.textContent='New File…';menu.append(add);document.body.append(menu);
  let returnFocus;
  const close=()=>{menu.hidden=true;};
  add.onclick=()=>{close();newFile();};
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){close();returnFocus?.focus();}});
  function showMenu(event) {
    event.preventDefault();returnFocus=event.currentTarget;menu.hidden=false;
    menu.style.left=Math.min(event.clientX,innerWidth-190)+'px';menu.style.top=Math.min(event.clientY,innerHeight-50)+'px';add.focus();
  }
  for(const [index,host] of [document.querySelector('.structure-tree-panel'),document.querySelector('#test-containment')].entries()) {
    const model=document.createElement('div');model.className='explorer-model';model.append(...host.children);
    const heading=document.createElement('div');heading.className='explorer-heading';heading.innerHTML='<span>EXPLORER</span>';
    const plus=document.createElement('button');plus.type='button';plus.textContent='＋';plus.setAttribute('aria-label','New file');plus.onclick=newFile;heading.append(plus);
    const tabs=document.createElement('nav');tabs.className='explorer-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Explorer view');
    const list=document.createElement('div');list.className='explorer-files';list.setAttribute('role','tree');list.setAttribute('aria-label','Project files');list.tabIndex=0;
    const filter=document.createElement('input');filter.className='explorer-filter';filter.placeholder='Filter files…';filter.setAttribute('aria-label','Filter files');
    for(const name of ['model','files']){
      const button=document.createElement('button');button.type='button';button.id=`explorer-${name}-${index}`;button.setAttribute('role','tab');button.textContent=name==='model'?'◇ Model':'▤ Files';button.dataset.explorer=name;
      button.onclick=()=>{selected=name;render();};tabs.append(button);
    }
    tabs.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();selected=event.key==='Home'?'model':event.key==='End'?'files':selected==='model'?'files':'model';render();tabs.querySelector('[aria-selected="true"]').focus();}});
    host.replaceChildren(heading,tabs,filter,model,list);host.classList.add('mercurio-explorer');
    host.addEventListener('contextmenu',showMenu);host.addEventListener('keydown',event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){const rect=host.getBoundingClientRect();showMenu({preventDefault:()=>event.preventDefault(),currentTarget:list,clientX:rect.x+20,clientY:rect.y+80});}});
    filter.oninput=()=>renderList(list,filter.value);
    sidebars.push({host,model,list,filter,tabs});
  }
  function renderList(list,query=''){
    list.replaceChildren();
    for(const file of files().filter(file=>file.name.toLowerCase().includes(query.toLowerCase()))){
      const button=document.createElement('button');button.type='button';button.setAttribute('role','treeitem');button.title=file.name;button.dataset.file=file.id;
      const icon=document.createElement('span');icon.className='explorer-file-icon';icon.textContent=file.kind==='definition'?'◇':file.kind==='python'?'Py':'▧';
      const label=document.createElement('span');label.textContent=file.name;button.append(icon,label);button.onclick=()=>openFile(file);list.append(button);
    }
  }
  function render(){for(const sidebar of sidebars){sidebar.model.hidden=selected!=='model';sidebar.list.hidden=selected!=='files';sidebar.filter.hidden=selected!=='files';for(const tab of sidebar.tabs.children){const active=tab.dataset.explorer===selected;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}renderList(sidebar.list,sidebar.filter.value);}}
  document.addEventListener('toolkit:files-changed',()=>render());
  render();
}
