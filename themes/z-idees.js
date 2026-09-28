/*
 * Atelier Aimanté — idées toutes prêtes pour le thème libre hors ligne.
 *
 * Quand Claude n'est pas disponible (fichier ouvert en local, IA refusée),
 * un texte comme « cirque » ou « pirates » ne correspond à aucun thème de
 * l'atelier. Ces plans de modules, assemblés par MT.compose, couvrent les
 * idées d'enfants les plus fréquentes. Un plan par nombre de packs.
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const it = (module, x, z, params, label, rot) => ({ module, x, z, rot: rot || 0, params: params || {}, label });

  MT.PRESET_PLANS = [
    {
      id: 'cirque',
      name: 'Cirque',
      keywords: ['cirque', 'chapiteau', 'clown', 'acrobate', 'jongleur', 'dompteur', 'trapeze', 'piste', 'magicien', 'spectacle', 'funambule'],
      plans: {
        1: {
          title: 'Le cirque arrive en ville',
          summary: 'Un chapiteau rayé, un manège, un lion et la roulotte des artistes.',
          items: [
            it('chapiteau', 5, 0, { base: 'hexagone', niveaux: 1, toit: 'pointu', rayures: true }, 'Chapiteau'),
            it('manege', 0, 0, { base: 'hexagone', chevaux: 3, toit: 'bas' }, 'Petit manège'),
            it('animal', 0, 4, { espece: 'lion', taille: 1 }, 'Lion du dompteur'),
            it('c-camping-car', 8, 4, {}, 'Roulotte des artistes'),
          ],
        },
        2: {
          title: 'Le grand cirque',
          summary: 'Un grand chapiteau, un manège, une grande roue, un lion, un cheval et les roulottes.',
          items: [
            it('chapiteau', 6, 0, { base: 'hexagone', niveaux: 2, toit: 'pointu', rayures: true }, 'Grand chapiteau'),
            it('manege', 0, 0, { base: 'hexagone', chevaux: 6, toit: 'pointu' }, 'Manège'),
            it('grande-roue', 10, 0, { taille: 1 }, 'Grande roue'),
            it('animal', 0, 4, { espece: 'lion', taille: 2 }, 'Lion'),
            it('animal', 0, 7, { espece: 'cheval', taille: 1 }, 'Cheval de voltige'),
            it('c-camping-car', 7, 5, {}, 'Roulotte des clowns'),
            it('c-camping-car', 11, 5, {}, 'Roulotte des acrobates'),
          ],
        },
      },
    },
    {
      id: 'pirates',
      name: 'Pirates',
      keywords: ['pirate', 'corsaire', 'bateau', 'navire', 'tresor', 'capitaine', 'crochet', 'ile', 'mer', 'port', 'bateaux', 'voilier', 'marin'],
      plans: {
        1: {
          title: 'Le repaire des pirates',
          summary: 'Un bateau pirate amarré près d’une tour de guet, des palmiers et le coffre au trésor.',
          items: [
            it('bateau', 0, 4, { longueur: 3, style: 'pirate' }, 'Bateau pirate'),
            it('tour', 6, 0, { etages: 3, toit: 'fleche', porte: true }, 'Tour de guet'),
            it('palmier', 0, 0, { hauteur: 2, touffu: false }, 'Palmier'),
            it('solide', 9, 4, { forme: 'cube', motif: 'plein' }, 'Coffre au trésor'),
          ],
        },
        2: {
          title: 'L’île aux pirates',
          summary: 'Deux navires, un fort à créneaux, des palmiers et le coffre au trésor.',
          items: [
            it('bateau', 0, 6, { longueur: 4, style: 'pirate' }, 'Navire du capitaine'),
            it('bateau', 6, 6, { longueur: 3, style: 'voilier' }, 'Voilier'),
            it('rempart', 6, 0, { longueur: 3, hauteur: 2, tours: true, porte: true, creneaux: true, toit: 'pyramide' }, 'Fort des pirates'),
            it('palmier', 0, 0, { hauteur: 3, touffu: true }, 'Grand palmier'),
            it('palmier', 13, 0, { hauteur: 2, touffu: false }, 'Palmier'),
            it('solide', 13, 5, { forme: 'cube', motif: 'plein' }, 'Coffre au trésor'),
          ],
        },
      },
    },
    {
      id: 'fete-foraine',
      name: 'Fête foraine',
      keywords: ['fete foraine', 'foire', 'manege', 'carrousel', 'grande roue', 'parc d attraction', 'attraction', 'kermesse', 'fete', 'luna park', 'barbe a papa'],
      plans: {
        1: {
          title: 'La fête foraine',
          summary: 'Une grande roue, un manège de chevaux et deux stands.',
          items: [
            it('grande-roue', 0, 0, { taille: 1 }, 'Grande roue'),
            it('manege', 6, 0, { base: 'hexagone', chevaux: 4, toit: 'pointu' }, 'Manège de chevaux'),
            it('boutique', 0, 3, { largeur: 2, enseigne: 'auvent', vitrine: 'doubles', toit: 'plat' }, 'Stand de barbe à papa'),
            it('boutique', 4, 4, { largeur: 1, enseigne: 'triangle', vitrine: 'cadres', toit: 'pyramide' }, 'Stand de tir'),
          ],
        },
        2: {
          title: 'Le grand parc d’attractions',
          summary: 'Une grande roue géante, deux manèges, un petit train et des stands.',
          items: [
            it('grande-roue', 0, 0, { taille: 2 }, 'Grande roue'),
            it('manege', 7, 0, { base: 'hexagone', chevaux: 6, toit: 'pointu' }, 'Carrousel'),
            it('manege', 11, 0, { base: 'carre', chevaux: 2, toit: 'bas' }, 'Manège des petits'),
            it('train', 0, 5, { wagons: 1, locomotive: 'vapeur', composition: 'voyageurs' }, 'Petit train'),
            it('boutique', 7, 4, { largeur: 2, enseigne: 'auvent', vitrine: 'doubles', toit: 'plat' }, 'Stand de gaufres'),
            it('boutique', 11, 4, { largeur: 1, enseigne: 'auvent', vitrine: 'cadres', toit: 'plat' }, 'Stand de tir'),
          ],
        },
      },
    },
    {
      id: 'zoo',
      name: 'Zoo',
      keywords: ['zoo', 'safari', 'savane', 'girafe', 'lion', 'animaux sauvages', 'jungle', 'afrique', 'parc animalier', 'soigneur'],
      plans: {
        1: {
          title: 'Le petit zoo',
          summary: 'Une girafe, un lion dans son enclos et la cabane du soigneur.',
          items: [
            it('enclos', 0, 0, { largeur: 5, profondeur: 3, cloture: 'cadres', abri: false, portillon: true, animal: 'lion' }, 'Enclos du lion'),
            it('animal', 0, 5, { espece: 'girafe', taille: 1 }, 'Girafe'),
            it('maisonnette', 7, 0, { etages: 1, toit: 'pyramide' }, 'Cabane du soigneur'),
            it('arbre', 7, 3, { feuillage: 'buisson', tronc: false }, 'Buisson'),
          ],
        },
        2: {
          title: 'Le grand zoo',
          summary: 'Des enclos pour le lion et la girafe, un palmier, la cabane du soigneur et le petit train du zoo.',
          items: [
            it('enclos', 0, 0, { largeur: 5, profondeur: 3, cloture: 'demi', abri: true, portillon: true, animal: 'lion' }, 'Enclos du lion'),
            it('enclos', 7, 0, { largeur: 6, profondeur: 3, cloture: 'cadres', abri: false, portillon: true, animal: 'girafe' }, 'Enclos de la girafe'),
            it('palmier', 0, 5, { hauteur: 3, touffu: true }, 'Palmier'),
            it('maisonnette', 5, 6, { etages: 2, toit: 'pyramide' }, 'Maison du soigneur'),
            it('train', 8, 6, { wagons: 1, locomotive: 'diesel', composition: 'voyageurs' }, 'Petit train du zoo'),
          ],
        },
      },
    },
    {
      id: 'dragon',
      name: 'Dragon',
      keywords: ['dragon', 'dragons', 'chevalier dragon', 'krokmou', 'monstre', 'cracheur de feu', 'grotte'],
      plans: {
        1: {
          title: 'Le dragon et la tour',
          summary: 'Un dragon garde la tour de la princesse ; un chevalier campe près du feu.',
          items: [
            it('animal', 0, 4, { espece: 'dragon', taille: 2 }, 'Dragon'),
            it('tour', 6, 0, { etages: 4, toit: 'fleche', porte: true }, 'Tour de la princesse'),
            it('tente', 0, 0, { forme: 'canadienne', longueur: 2, ouverte: true }, 'Tente du chevalier'),
            it('feu-de-camp', 4, 0, { style: 'flammes' }, 'Feu de camp'),
          ],
        },
        2: {
          title: 'Le château du dragon',
          summary: 'Un dragon géant devant un château à tours et donjon, avec le campement des chevaliers.',
          items: [
            it('chateau', 0, 0, { largeur: 5, profondeur: 4, hauteur: 1, tours: 4, donjon: true, porte: 'arche', toits: 'varies', tente: false, pontLevis: true }, 'Château du roi'),
            it('animal', 0, 7, { espece: 'dragon', taille: 2 }, 'Dragon'),
            it('tente', 7, 0, { forme: 'canadienne', longueur: 2, ouverte: true }, 'Tente des chevaliers'),
            it('feu-de-camp', 7, 4, { style: 'flammes' }, 'Feu de camp'),
          ],
        },
      },
    },
    {
      id: 'noel',
      name: 'Noël',
      keywords: ['noel', 'pere noel', 'sapin de noel', 'cadeau', 'lutin', 'renne', 'traineau', 'hiver', 'neige', 'decembre', 'village de noel'],
      plans: {
        1: {
          title: 'Le village de Noël',
          summary: 'Deux sapins, la maison du Père Noël, des cadeaux et le traîneau.',
          items: [
            it('sapin', 5, 0, { forme: 'noel', tronc: 1, etages: 1, cime: 'fleche' }, 'Sapin de Noël'),
            it('sapin', 8, 4, { forme: 'simple', tronc: 1, etages: 1, cime: 'fleche' }, 'Petit sapin'),
            it('maison', 0, 0, { longueur: 2, largeur: 1, etages: 1, fenetres: 'carreaux', toit: 'deux-pans', jardin: false, appentis: false }, 'Maison du Père Noël'),
            it('solide', 0, 3, { forme: 'cube', motif: 'rayures' }, 'Cadeau'),
            it('solide', 3, 3, { forme: 'pave', motif: 'cadres' }, 'Gros cadeau'),
            it('c-camping-car', 9, 1, {}, 'Traîneau du Père Noël'),
          ],
        },
        2: {
          title: 'Noël au village',
          summary: 'Deux sapins de Noël, la maison du Père Noël, l’atelier des lutins, des cadeaux et le traîneau.',
          items: [
            it('sapin', 6, 0, { forme: 'noel', tronc: 1, etages: 3, cime: 'fleche' }, 'Grand sapin de Noël'),
            it('maison', 0, 0, { longueur: 3, largeur: 2, etages: 2, fenetres: 'carreaux', toit: 'deux-pans', jardin: false, appentis: false }, 'Maison du Père Noël'),
            it('boutique', 10, 0, { largeur: 2, enseigne: 'fronton', vitrine: 'quatre-carreaux', toit: 'pyramide' }, 'Atelier des lutins'),
            it('sapin', 10, 4, { forme: 'simple', tronc: 1, etages: 1, cime: 'fleche' }, 'Petit sapin'),
            it('solide', 0, 4, { forme: 'cube', motif: 'rayures' }, 'Cadeau'),
            it('solide', 3, 4, { forme: 'pave', motif: 'cadres' }, 'Gros cadeau'),
            it('c-camping-car', 6, 5, {}, 'Traîneau du Père Noël'),
          ],
        },
      },
    },
    {
      id: 'oasis',
      name: 'Oasis',
      keywords: ['oasis', 'desert', 'plage', 'tropique', 'palmier', 'vacances', 'ile deserte', 'sable', 'chameau'],
      plans: {
        1: {
          title: 'L’oasis',
          summary: 'Des palmiers autour d’un temple, un obélisque et une tente de voyageurs.',
          items: [
            it('palmier', 0, 0, { hauteur: 3, touffu: true }, 'Grand palmier'),
            it('palmier', 8, 0, { hauteur: 2, touffu: false }, 'Palmier'),
            it('obelisque', 5, 0, { niveaux: 2, pointe: 'pyramidion', socle: false }, 'Obélisque'),
            it('tente', 4, 3, { forme: 'canadienne', longueur: 2, ouverte: true }, 'Tente des voyageurs'),
            it('pyramide', 0, 4, { n: 1, base: false }, 'Petite pyramide'),
          ],
        },
        2: {
          title: 'La grande oasis',
          summary: 'Une pyramide, des palmiers, un obélisque, des tentes et un camping-car d’explorateurs.',
          items: [
            it('pyramide', 0, 0, { n: 2, base: false }, 'Pyramide'),
            it('palmier', 4, 0, { hauteur: 3, touffu: true }, 'Grand palmier'),
            it('palmier', 8, 0, { hauteur: 2, touffu: true }, 'Palmier'),
            it('obelisque', 12, 0, { niveaux: 3, pointe: 'fleche', socle: true }, 'Obélisque'),
            it('tente', 0, 4, { forme: 'canadienne', longueur: 2, ouverte: true }, 'Tente'),
            it('tente', 4, 4, { forme: 'tipi', longueur: 1, ouverte: false }, 'Tente ronde'),
            it('c-camping-car', 8, 5, {}, 'Camping-car des explorateurs'),
          ],
        },
      },
    },
  ];
})(typeof window !== 'undefined' ? window : globalThis);
