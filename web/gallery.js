for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const code=document.getElementById(button.dataset.copy);
    try {await navigator.clipboard.writeText(code.textContent);button.textContent='Copied';}
    catch {button.textContent='Select code to copy';}
    setTimeout(()=>{button.textContent='Copy';},2000);
  });
}
