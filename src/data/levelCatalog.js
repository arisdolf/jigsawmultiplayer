// Key = image file name (without extension), e.g. "level-01" for level-01.jpg
export const LEVEL_CATALOG = {
  'level-01': {
    title: 'Jinx & Isha – A Moment of Happiness',
    description: 'A heartwarming bond between Jinx and Isha, two souls who found comfort, trust, and happiness in each other despite the chaos surrounding them.',
    imageAlt: 'Jinx and Isha happily spending time together, smiling and embracing one another.',
    pieceCount: 25,
    difficulty: 'Very Easy',
    allowRotation: false,
    requires: null,          // level that must be finished first
    imageRotation: 360,
  },
  'level-02': {
    title: 'Team Avatar – A Feast Together',
    description: 'A joyful gathering of Team Avatar, bringing together friends and family for a memorable meal. Away from their adventures and battles, they enjoy each others company.',
    imageAlt: 'Aang, Katara, Sokka, Toph, Zuko, and their friends sitting around a large dining table, happily enjoying a delicious feast.',
    pieceCount: 64,
    difficulty: 'Easy',
    allowRotation: false,
    requires: 'level-01',
    imageRotation: 270,
  },
  'level-03': {
    title: 'City Lights',
    description: 'Pieces can be rotated on this one.',
    imageAlt: 'A city skyline at night',
    pieceCount: 150,
    difficulty: 'Normal',
    allowRotation: true,
    requires: 'level-02',
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
}