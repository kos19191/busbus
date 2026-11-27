import { h } from './dom';

/** Простой модальный диалог, совместимый с WebView Android (без нативных alert). */
export function alertDialog(title: string, text: string): Promise<void> {
  return new Promise((resolve) => {
    const overlay = h('div', {
      style: {
        position: 'fixed',
        inset: '0',
        zIndex: '100',
        background: 'rgba(4,8,14,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '18px',
        backdropFilter: 'blur(3px)',
      },
    });
    const close = () => {
      overlay.remove();
      resolve();
    };
    const box = h(
      'div',
      {
        class: 'card',
        style: { maxWidth: '440px', width: '100%', background: 'var(--panel-solid)', boxShadow: 'var(--shadow)' },
      },
      h('h3', { class: 'card__title' }, title),
      h('div', { class: 'settings-note', style: { whiteSpace: 'pre-wrap' } }, text),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '14px' } }, h('button', { class: 'btn btn--primary', type: 'button', onClick: close }, 'Понятно')),
    );
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.append(box);
    document.body.append(overlay);
  });
}

export function confirmDialog(title: string, text: string, okLabel = 'ОК', cancelLabel = 'Отмена'): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = h('div', {
      style: {
        position: 'fixed',
        inset: '0',
        zIndex: '100',
        background: 'rgba(4,8,14,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '18px',
      },
    });
    const done = (value: boolean) => {
      overlay.remove();
      resolve(value);
    };
    overlay.append(
      h(
        'div',
        { class: 'card', style: { maxWidth: '420px', width: '100%', background: 'var(--panel-solid)' } },
        h('h3', { class: 'card__title' }, title),
        h('div', { class: 'settings-note' }, text),
        h(
          'div',
          { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px' } },
          h('button', { class: 'btn', type: 'button', onClick: () => done(false) }, cancelLabel),
          h('button', { class: 'btn btn--primary', type: 'button', onClick: () => done(true) }, okLabel),
        ),
      ),
    );
    document.body.append(overlay);
  });
}
