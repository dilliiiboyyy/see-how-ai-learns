export interface BuiltInCategoryDef {
  id: string;
  name: string;
  slug: string;
  description: string;
  targetCount: number;
  searchQueries: string[];
}

export const BUILT_IN_CATEGORIES: BuiltInCategoryDef[] = [
  {
    id: 'cat_pens',
    name: 'Pen',
    slug: 'pens',
    description: 'Ballpoint, fountain, rollerball, and felt-tip writing pens across varied angles and surfaces.',
    targetCount: 50,
    searchQueries: ['ballpoint pen', 'fountain pen', 'gel pen', 'ink pen writing'],
  },
  {
    id: 'cat_books',
    name: 'Book',
    slug: 'books',
    description: 'Hardcover, paperback, open pages, and stacked volumes in varied lighting.',
    targetCount: 50,
    searchQueries: ['hardcover book', 'open book pages', 'paperback book', 'stack of books'],
  },
  {
    id: 'cat_water_bottles',
    name: 'Water bottle',
    slug: 'water-bottles',
    description: 'Reusable steel, glass, sport, and clear plastic water bottles in everyday settings.',
    targetCount: 50,
    searchQueries: ['reusable water bottle', 'plastic water bottle', 'stainless steel water bottle', 'drinking bottle'],
  },
  {
    id: 'cat_computer_mice',
    name: 'Computer mouse',
    slug: 'computer-mice',
    description: 'Wired, wireless, optical, and ergonomic computer mice on desks and neutral backgrounds.',
    targetCount: 50,
    searchQueries: ['computer mouse', 'wireless optical mouse', 'ergonomic mouse desk', 'scroll wheel mouse'],
  },
  {
    id: 'cat_cars',
    name: 'Car',
    slug: 'cars',
    description: 'Sedans, hatchbacks, compact city cars, and automobiles photographed from multiple angles.',
    targetCount: 50,
    searchQueries: ['sedan car street', 'hatchback automobile', 'electric car parked', 'compact car side'],
  },
  {
    id: 'cat_mobile_phones',
    name: 'Mobile phone',
    slug: 'mobile-phones',
    description: 'Modern smartphones and handheld mobile phones in portrait, angled, and tabletop views.',
    targetCount: 50,
    searchQueries: ['smartphone touchscreen', 'mobile phone handheld', 'android smartphone', 'cell phone device'],
  },
  {
    id: 'cat_keys',
    name: 'Keys',
    slug: 'keys',
    description: 'Brass house keys, keychains, padlocks with keys, and automotive key fobs.',
    targetCount: 50,
    searchQueries: ['house keys keyring', 'brass door key', 'car key fob', 'bunch of keys'],
  },
  {
    id: 'cat_cups',
    name: 'Cup',
    slug: 'cups',
    description: 'Ceramic mugs, porcelain teacups, glass tumblers, and espresso cups.',
    targetCount: 50,
    searchQueries: ['ceramic coffee mug', 'porcelain teacup', 'espresso cup saucer', 'glass drinking cup'],
  },
  {
    id: 'cat_backpacks',
    name: 'Backpack',
    slug: 'backpacks',
    description: 'Canvas daypacks, hiking rucksacks, laptop backpacks, and school bags.',
    targetCount: 50,
    searchQueries: ['hiking backpack', 'canvas daypack', 'school backpack bag', 'travel rucksack'],
  },
  {
    id: 'cat_watches',
    name: 'Watch',
    slug: 'watches',
    description: 'Analog wristwatches, chronographs, leather-strap watches, and digital timepieces.',
    targetCount: 50,
    searchQueries: ['analog wristwatch', 'chronograph wrist watch', 'mechanical wristwatch', 'digital wristwatch'],
  },
  {
    id: 'cat_pencils',
    name: 'Pencil',
    slug: 'pencils',
    description: 'Wooden graphite pencils, colored pencils, sharpened tips, and mechanical pencils.',
    targetCount: 50,
    searchQueries: ['wooden graphite pencil', 'colored pencils', 'mechanical pencil', 'sharpened yellow pencil'],
  },
  {
    id: 'cat_chairs',
    name: 'Chair',
    slug: 'chairs',
    description: 'Wooden dining chairs, ergonomic office chairs, armchairs, and minimalist seating.',
    targetCount: 50,
    searchQueries: ['wooden dining chair', 'ergonomic office chair', 'modern armchair', 'folding chair'],
  },
];
