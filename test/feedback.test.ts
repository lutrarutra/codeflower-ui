import assert from 'node:assert/strict';
import test from 'node:test';
import { feedbackAnnotations, feedbackFigure, feedbackText } from '../src/chat/lib/feedback.ts';
import { chooseSelectable } from '../src/chat/lib/svgSelect.ts';

test('feedback lists the comments on parts of the figure, then the general comment', () => {
  assert.equal(
    feedbackText('figures/a.png', 'VS Code', 'bigger labels'),
    'Feedback on figures/a.png, which you showed me in VS Code:\n\nbigger labels'
  );
  assert.equal(
    feedbackText('figures/toy.svg', 'the code flower app', 'Looks good otherwise.', [
      { comment: 'make it smaller', elements: [{ id: 'mouse', label: 'Mouse' }] },
      { comment: 'align these\nand use one color', elements: [{ id: 'arrow-1' }, { id: 'arrow-2', label: 'arrow-2' }, { id: 'umap', label: 'UMAP' }] },
      {
        comment: 'too crowded',
        region: { x: 0.1, y: 0.25, width: 0.3, height: 0.5, units: { x: 20, y: 25.04, width: 60, height: 50, unit: 'svg' } }
      }
    ]),
    [
      'Feedback on figures/toy.svg, which you showed me in the code flower app:',
      '',
      '1. On #mouse (Mouse): make it smaller',
      '2. On #arrow-1, #arrow-2 and #umap (UMAP): align these',
      '   and use one color',
      '3. On the area at x 20–80, y 25–75 (SVG coordinates; x 10%–40%, y 25%–75% of the figure): too crowded',
      '',
      'Looks good otherwise.'
    ].join('\n')
  );
  assert.equal(
    feedbackText('plot.png', 'VS Code', '', [{ comment: 'outlier?', region: { x: 0.5, y: 0, width: 0.5, height: 0.5 } }]),
    'Feedback on plot.png, which you showed me in VS Code:\n\n1. On the area at x 50%–100%, y 0%–50% of the figure: outlier?'
  );
});

test('comments from a webview are checked and trimmed', () => {
  assert.deepEqual(feedbackAnnotations(undefined), []);
  assert.deepEqual(
    feedbackAnnotations([
      { comment: '  smaller ', elements: [{ id: ' mouse ', label: 'A\n  mouse', tag: 'g' }, { id: 'mouse' }, { id: 7 }, 'x'] },
      { comment: '', elements: [{ id: 'cells' }] },
      { comment: 'about nothing' },
      { comment: 'clamped', region: { x: 0.8, y: -1, width: 0.5, height: 2, units: { x: 1, y: 2, width: 3, height: Infinity, unit: 'px' } } },
      { comment: 'bad region', region: { x: 'a', y: 0, width: 1, height: 1 } },
      'text'
    ]),
    [
      { comment: 'smaller', elements: [{ id: 'mouse', label: 'A mouse', tag: 'g' }] },
      { comment: 'clamped', region: { x: 0.8, y: 0, width: 1 - 0.8, height: 1 } }
    ]
  );
  assert.equal(feedbackAnnotations(Array.from({ length: 80 }, (_, index) => ({ comment: 'c', elements: [{ id: `e${index}` }] }))).length, 50);
});

test('a click selects the nearest labelled element, else the nearest with an id', () => {
  // A path inside an inlined icon: its own prefixed id, the icon's labelled group, the panel.
  assert.equal(
    chooseSelectable([
      { id: null, label: null },
      { id: 'mouse-body', label: null },
      { id: 'mouse', label: 'Mouse' },
      { id: 'panel-a', label: 'Panel A' }
    ]),
    2
  );
  assert.equal(chooseSelectable([{ id: null, label: null }, { id: 'arrow-1', label: null }]), 1);
  assert.equal(chooseSelectable([{ id: null, label: 'no id' }]), -1);
  assert.equal(chooseSelectable([]), -1);
});

test('feedback on a report figure says which figure it is', () => {
  assert.equal(
    feedbackText('reports/pbmc.html', 'VS Code', '', [{ comment: 'bigger', elements: [{ id: 'mouse', label: 'Mouse' }] }], {
      index: 2,
      caption: 'The workflow, from tissue to cell types.',
      part: 'design',
      anchor: 'design'
    }),
    'Feedback on figure 2 ("The workflow, from tissue to cell types.", part design) in reports/pbmc.html, which you showed me in VS Code:\n\n1. On #mouse (Mouse): bigger'
  );
  assert.deepEqual(feedbackFigure({ index: 3, caption: ' A\n caption ', part: '', anchor: 'fig-qc', extra: 1 }), {
    index: 3,
    caption: 'A caption',
    anchor: 'fig-qc'
  });
  assert.equal(feedbackFigure({ index: 0 }), undefined);
  assert.equal(feedbackFigure({ index: 1.5 }), undefined);
  assert.equal(feedbackFigure('figure 1'), undefined);
});
