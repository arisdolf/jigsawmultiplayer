// Key = image file name (without extension), e.g. "level-01" for level-01.jpg
export const LEVEL_CATALOG = {
  'level-01': {
    title: 'Jinx & Isha – A Moment of Happiness',
    description: 'A heartwarming bond between Jinx and Isha, two souls who found comfort, trust, and happiness in each other despite the chaos surrounding them.',
    imageAlt: 'Jinx and Isha happily spending time together, smiling and embracing one another.',
    pieceCount: 25,
    difficulty: 'Very Easy',
    allowRotation: true,
    requires: null,          // level that must be finished first
    imageRotation: 360,
    imageShiftUp: 10,        // pixels above center; set 0 to center this image
  },
  'level-02': {
    title: 'Team Avatar – A Feast Together',
    description: 'A joyful gathering of Team Avatar, bringing together friends and family for a memorable meal. Away from their adventures and battles, they enjoy each others company.',
    imageAlt: 'Aang, Katara, Sokka, Toph, Zuko, and their friends sitting around a large dining table, happily enjoying a delicious feast.',
    pieceCount: 50,
    difficulty: 'Easy',
    allowRotation: true,
    requires: null,
    imageRotation: 270,
    imageShiftUp: 10,
  
  },
  'level-03': {
    title: 'Under the Parisian Sky – Ladybug & Cat Noir',
    description: 'Two beloved heroes sharing a peaceful moment together above the beautiful city of Paris. Away from their responsibilities as protectors, Ladybug and Cat Noir enjoy each others company, finding comfort.',
    imageAlt: 'Ladybug and Cat Noir sitting side by side on a rooftop, gazing at the magnificent Eiffel Tower glowing in the distance.',
    pieceCount: 45,
    difficulty: 'Normal',
    allowRotation: true,
    requires: null,
    imageRotation: 360,
    imageShiftUp: 10,
  },

  'level-04': {
    title: 'One Piece: A Crew Like Family',
    description: 'Celebrate the unbreakable bond of the Straw Hat Pirates. A crew brought together by adventure, friendship, laughter, and the dream of finding the legendary One Piece.',
    imageAlt: 'An anime-style illustration of the Straw Hat Pirates gathered closely together, smiling and enjoying a joyful moment.',
    pieceCount: 60,
    difficulty: 'hard',
    allowRotation: true,
    requires: null,
    imageRotation: 270,
    imageShiftUp: 10,
  },

   'level-05': {
    title: 'Spider-Verse: Across Dimensions',
    description: 'A vibrant comic-book illustration featuring multiple Spider-Man variants, including different masks and suits arranged in horizontal panels.',
    imageAlt: 'A vibrant comic-book illustration featuring multiple Spider-Man variants, including different masks and suits arranged in horizontal panels.',
    pieceCount: 60,
    difficulty: 'Normal',
    allowRotation: true,
    requires: null,
    imageRotation: 360,
    imageShiftUp: 10,
  },

   'level-06': {
    title: 'The Resurrection of Christ',
    description: 'A magnificent classical religious painting depicting Jesus Christ ascending triumphantly toward the heavens, surrounded by angels, heavenly clouds, and divine golden light.',
    imageAlt: 'Witness a powerful representation of faith, hope, and divine triumph. This breathtaking masterpiece captures the glory of Christs resurrection and the promise of eternal life.',
    pieceCount: 75,
    difficulty: 'hard',
    allowRotation: true,
    requires: null,
    imageRotation: 360,
    imageShiftUp: -70,
  },


  'level-07': {
    title: 'Floryn – Herald of Autumn',
    description: 'A graceful guardian of autumn, Floryn embraces the warmth of the changing seasons with an enchanting golden-orange outfit, elegant flowing garments, and magical seasonal details.',
    imageAlt: 'A mystical guardian adorned in elegant autumn-inspired attire, wielding the magic of golden leaves and nature. Her radiant presence brings warmth, healing, and the enchanting beauty of the fall season.',
    pieceCount: 90,
    difficulty: 'Hard',
    allowRotation: true,
    requires: null,
    imageRotation: 270,
    imageShiftUp: 10,
  },

  'level-08': {
    title: 'Architectural Wonders',
    description: 'Explore a world of architectural brilliance where history, creativity, and engineering come together.',
    imageAlt: 'A detailed vintage architectural collage featuring historical European buildings, the Eiffel Tower, grand libraries, classical sculptures, engineering blueprints, and intricate architectural sketches.',
    pieceCount: 150,
    difficulty: 'Very Hard',
    allowRotation: true,
    requires: null,
    imageRotation: 270,
    imageShiftUp: 10,
  },

  // add level-04 ... level-10 the same way
}

// Used when an image has no matching catalog entry
export const DEFAULT_RULES = {
  description: '',
  pieceCount: 25,
  difficulty: 'Easy',
  allowRotation: false,
  requires: null,
  imageRotation: 270,
  imageShiftUp: 0,
}
