import { getDocument, GlobalWorkerOptions } from '/vendor/pdfjs/pdf.mjs';

GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';

// A small, local-only viewer. Render nearby pages and release distant canvases.
export class PdfViewer {
  constructor(container, onPages) {
    this.container = container; this.onPages = onPages; this.generation = 0;
    this.resize = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => { if (this.pdf && this.zoom === 'page-width' && this.container.clientWidth > 0 && Math.abs(this.width - this.container.clientWidth) > 2) this.layout(); }, 150);
    });
    this.resize.observe(container);
  }
  clear() {
    ++this.generation; this.observer?.disconnect(); this.loading?.destroy()?.catch(() => {}); this.pdf = null; this.loading = null;
    this.container.replaceChildren();
  }
  async load(url, zoom) {
    if (this.url === url && this.pdf) { this.zoom = zoom; return this.layout(); }
    this.clear(); this.url = url; this.zoom = zoom;
    const generation = this.generation;
    const loading = this.loading = getDocument({ url, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', wasmUrl: '/vendor/pdfjs/wasm/', isEvalSupported: false });
    try {
      const pdf = await loading.promise;
      if (generation !== this.generation) { await loading.destroy(); return; }
      this.pdf = pdf; this.onPages(pdf.numPages); await this.layout();
    } catch (error) { if (generation === this.generation) throw error; }
  }
  async layout() {
    const pdf = this.pdf; if (!pdf || this.container.clientWidth < 1) return;
    const generation = ++this.generation;
    this.observer?.disconnect(); this.container.replaceChildren(); this.width = this.container.clientWidth;
    const width = Math.max(100, this.width - 40), zoom = this.zoom;
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const wrapper = entry.target;
        if (entry.isIntersecting && !wrapper.rendering && !wrapper.rendered) {
          wrapper.rendering = true;
          this.renderPage(pdf, wrapper, generation).catch(error => {
            if (generation === this.generation && error.name !== 'RenderingCancelledException') { wrapper.textContent = `Seite konnte nicht angezeigt werden: ${error.message}`; }
          }).finally(() => { wrapper.rendering = false; });
        } else if (!entry.isIntersecting && wrapper.rendered) {
          const canvas = wrapper.querySelector('canvas'); if (canvas) { canvas.width = 1; canvas.height = 1; } wrapper.rendered = false;
        }
      }
    }, { root: this.container, rootMargin: '600px' });
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number); if (generation !== this.generation) return;
      const original = page.getViewport({ scale: 1 }), scale = zoom === 'page-width' ? width / original.width : Number(zoom) / 100;
      const viewport = page.getViewport({ scale });
      const wrapper = document.createElement('div'); wrapper.className = 'pdf-page'; wrapper.dataset.page = number; wrapper.scale = scale;
      wrapper.style.width = `${viewport.width}px`; wrapper.style.height = `${viewport.height}px`; wrapper.setAttribute('role', 'img'); wrapper.setAttribute('aria-label', `PDF-Seite ${number} von ${pdf.numPages}`);
      this.container.append(wrapper); this.observer.observe(wrapper);
    }
  }
  async renderPage(pdf, wrapper, generation) {
    const page = await pdf.getPage(Number(wrapper.dataset.page)); if (generation !== this.generation) return;
    const scale = wrapper.scale, viewport = page.getViewport({ scale }), outputScale = Math.min(window.devicePixelRatio || 1, 2);
    let canvas = wrapper.querySelector('canvas'); if (!canvas) { canvas = document.createElement('canvas'); wrapper.append(canvas); }
    canvas.width = Math.ceil(viewport.width * outputScale); canvas.height = Math.ceil(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0] }).promise;
    if (generation === this.generation) wrapper.rendered = true;
  }
}
