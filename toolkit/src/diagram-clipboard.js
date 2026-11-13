// Export the rendered diagram, including offscreen classes, without changing
// source, layout, zoom, or selection. No external assets or rendering service.
const NS = 'http://www.w3.org/2000/svg';
const svgNode = (tag, attributes = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
};

function diagramSvg(canvas, edges, width, height, zoom) {
  const svg = svgNode('svg', { xmlns: NS, width, height, viewBox: `0 0 ${width} ${height}` });
  const background = getComputedStyle(canvas.closest('.structure-viewport')).backgroundColor;
  svg.append(svgNode('rect', { width, height, fill: background }));
  const relationships = edges.cloneNode(true);
  const originals = [edges, ...edges.querySelectorAll('*')];
  const copies = [relationships, ...relationships.querySelectorAll('*')];
  const properties = ['fill', 'stroke', 'stroke-width', 'stroke-linejoin', 'paint-order', 'font-family', 'font-size', 'font-weight'];
  originals.forEach((original, index) => {
    const style = getComputedStyle(original);
    for (const property of properties) copies[index].style.setProperty(property, style.getPropertyValue(property));
  });
  svg.append(relationships);
  const origin = canvas.getBoundingClientRect();
  const bounds = node => {
    const rect = node.getBoundingClientRect();
    return { x: (rect.x - origin.x) / zoom, y: (rect.y - origin.y) / zoom, width: rect.width / zoom, height: rect.height / zoom };
  };
  let clipId = 0;
  for (const card of canvas.querySelectorAll('.structure-class')) {
    const group = svgNode('g'); const box = bounds(card); const style = getComputedStyle(card);
    group.append(svgNode('rect', { ...box, rx: 6, fill: style.backgroundColor, stroke: style.borderColor }));
    const heading = card.querySelector('.structure-class-title');
    group.append(svgNode('rect', { ...bounds(heading), rx: 5, fill: getComputedStyle(heading).backgroundColor }));
    for (const row of card.querySelectorAll('.structure-feature[aria-pressed="true"]')) group.append(svgNode('rect', { ...bounds(row), fill: getComputedStyle(row).backgroundColor }));
    for (const node of card.querySelectorAll('.structure-class-stereotype, .structure-class-title strong, .structure-feature > span, .structure-class-empty')) {
      const rect = bounds(node); const textStyle = getComputedStyle(node);
      const centered = heading.contains(node);
      const clip = svgNode('clipPath', { id: `copy-text-${clipId++}` });
      clip.append(svgNode('rect', rect)); group.append(clip);
      const text = svgNode('text', {
        x: centered ? rect.x + rect.width / 2 : rect.x + parseFloat(textStyle.paddingLeft || 0),
        y: rect.y + rect.height / 2, 'text-anchor': centered ? 'middle' : 'start',
        'dominant-baseline': 'central', 'clip-path': `url(#${clip.id})`, fill: textStyle.color,
        'font-family': textStyle.fontFamily, 'font-size': textStyle.fontSize, 'font-weight': textStyle.fontWeight,
        'letter-spacing': textStyle.letterSpacing,
      });
      text.textContent = node.textContent; group.append(text);
    }
    svg.append(group);
  }
  return new XMLSerializer().serializeToString(svg);
}

export function diagramPng(canvas, edges, width, height, zoom) {
  // Snapshot synchronously so a later edit cannot change an in-flight copy.
  const source = diagramSvg(canvas, edges, width, height, zoom);
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16_000_000 / (width * height)));
  if (scale < 0.25) return Promise.reject(new Error('Diagram is too large to copy clearly. Move classes closer together or use Auto-layout.'));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
    const image = new Image();
    image.onload = () => {
      try {
        const bitmap = document.createElement('canvas');
        bitmap.width = Math.ceil(width * scale); bitmap.height = Math.ceil(height * scale);
        const context = bitmap.getContext('2d');
        if (!context) throw new Error('Image rendering is unavailable in this browser.');
        context.drawImage(image, 0, 0, bitmap.width, bitmap.height);
        bitmap.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create the diagram image.')), 'image/png');
      } catch (error) { reject(error); }
      finally { URL.revokeObjectURL(url); }
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not render the diagram image.')); };
    image.src = url;
  });
}

export async function copyDiagram(canvas, edges, width, height, zoom) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image clipboard access is unavailable. Open the toolkit on localhost or HTTPS in a supported browser.');
  // Start the clipboard write during the click gesture (also required by Safari).
  const png = diagramPng(canvas, edges, width, height, zoom);
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]); }
  catch (error) {
    // Observe rendering failures even when clipboard permission is denied first.
    await png.catch(() => {});
    throw new Error(error.name === 'NotAllowedError' ? 'Clipboard access was blocked. Allow clipboard access for this page and try again.' : error.message);
  }
}
