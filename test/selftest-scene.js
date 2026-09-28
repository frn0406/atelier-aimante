/* Scène de contrôle du moteur : une construction par primitive du Builder. */
(function (root) {
  'use strict';
  const MT = root.MT;
  MT.registerTheme({
    id: 'selftest',
    name: 'Scène de contrôle',
    emoji: '🧪',
    keywords: [],
    generate(b) {
      b.step('Tour');
      for (let l = 0; l < 3; l++) b.box(0, l, 0, { S: l === 0 ? 'arch' : 'window' });
      b.pyramidRoof(0, 3, 0, 'TT');

      b.step('Maison 3 × 2');
      b.room(3, 0, 0, 3, 2, ({ side, i }) => (side === 'S' && i === 1 ? 'arch' : 'window'));
      b.step('Toit à deux pans');
      b.gableRoof(3, 1, 0, 3, 2, 'x');

      b.step('Pyramide 2 × 2');
      b.bigPyramid(0, 0, 4, 2);

      b.step('Tente en A');
      b.aFrame(4, 0, 4, 2, 'x');

      b.step('Wagon');
      b.car(7, 0, 'x');
      b.box(7, MT.CAR.top, 0, {});
      b.box(8, MT.CAR.top, 0, {});

      b.step('Rempart crénelé');
      b.room(0, 0, 8, 3, 1, 'solid');
      b.crenelRim(0, 1, 8, 3, 1);

      b.step('Maisonnette tournée');
      b.at({ x: 10, z: 4, rot: 90, w: 2, d: 1 }, () => {
        b.box(0, 0, 0, {});
        b.box(1, 0, 0, {});
        b.gableRoof(0, 1, 0, 2, 1, 'x');
      });

      b.step('Tourelle pointue');
      b.box(10, 0, 0, { N: 'frame' });
      b.pyramidRoof(10, 1, 0, 'EQ');

      b.step('Cube posé sur un plancher');
      b.box(13, 0, 0, { floor: true, top: true });
      return { title: 'Scène de contrôle', summary: 'Toutes les primitives du moteur.' };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
