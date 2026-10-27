// Synthetic retained state; no gameplay data, native commands or profile access.
(() => {
  const values = new Float64Array(4_000_000);
  for (let i = 0; i < values.length; i++) values[i] = i + 0.25;
  const canvases = Array.from({ length: 24 }, () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillRect(0, 0, 1024, 1024);
    context.getImageData(0, 0, 1, 1);
    document.body.append(canvas);
    return canvas;
  });
  const content = document.createElement('section');
  for (let i = 0; i < 10_000; i++) {
    const row = document.createElement('p');
    row.textContent = `Retained record ${i}`;
    content.append(row);
  }
  document.body.append(content);
  window.memoryFixture = {
    values,
    canvases,
    content,
    selection: { tab: 'pets', zoom: 1.3, x: 35, y: -8 },
    check() {
      return (
        this.values.length === 4_000_000 &&
        this.values[123456] === 123456.25 &&
        this.values[3999999] === 3999999.25 &&
        this.content.children.length === 10_000 &&
        this.selection.tab === 'pets' &&
        this.selection.zoom === 1.3 &&
        this.selection.x === 35 &&
        this.selection.y === -8 &&
        this.canvases.every(
          (canvas) => canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3] === 255,
        )
      );
    },
  };
  location.hash = 'ready';
})();
