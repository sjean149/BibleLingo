// Which of the five helpers (src/art/characters.js) waits beside a chapter on the path.
// Books are matched by their position in the Bible (Book.order: 40 = Matthew ... 66 = Revelation),
// which is the same in every language, unlike the book's name.

// In the Gospels the helper follows the chapter's setting (sceneForChapter in ./scenes).
const BY_SCENE = {
  sea: 'fish', // Galilee's fishermen
  desert: 'camel', // the roads between towns, the Magi's journey
  wilderness: 'camel', // John the Baptist by the Jordan
  field: 'lamb', // shepherds and pasture
  forest: 'lamb', // the olive grove of Gethsemane
  mountain: 'jesus', // the Sermon on the Mount, the Transfiguration
  town: 'jesus', // teaching in Jerusalem and the villages
  map: 'camel',
};

// A few chapters are better known for something else.
const SPECIAL = {
  '43:1': 'lamb', // John 1:29, "Behold the Lamb of God"
  '43:21': 'fish', // the miraculous catch by the Sea of Tiberias
};

const GOSPELS = { first: 40, last: 43 }; // Matthew to John
const PAUL = { first: 44, last: 57 }; // Acts (Paul's journeys from chapter 9) and Romans to Philemon
const REVELATION = 66;

export function guideForChapter(bookOrder, chapterNumber, scene) {
  const special = SPECIAL[`${bookOrder}:${chapterNumber}`];
  if (special) return special;
  if (bookOrder >= GOSPELS.first && bookOrder <= GOSPELS.last) return BY_SCENE[scene] ?? 'lamb';
  if (bookOrder >= PAUL.first && bookOrder <= PAUL.last) return 'paul';
  if (bookOrder === REVELATION) return 'lamb'; // "the Lamb" of Revelation 5
  return 'fish'; // Hebrews to Jude: the fish, the early Christians' sign
}
