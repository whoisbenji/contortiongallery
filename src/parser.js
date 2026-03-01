/**
 * Parser for database-roncdX-strings.txt files.
 *
 * Each entry in the file is two consecutive non-blank lines:
 *
 *   Line 1 (path):  f:\cdv2\a\mono
 *   Line 2 (data):  JF0095.JPG     47439  Ivory Coast acrobats, Female, BackBend
 *
 * The path line is the original Windows CD path.  We strip the drive letter and
 * the first directory segment (the CD root, e.g. "cdv2") to get a relative
 * subfolder such as "a/mono" that we can join to the user-selected volume root.
 *
 * The data line fields are whitespace-delimited up to the file size, then the
 * remainder is comma-delimited metadata:
 *   FILENAME.JPG  <file-size>  <performer/group>, <gender>, <category1>[, <category2>…]
 */

/**
 * @param {string} content   Raw text content of the database file.
 * @param {number} volumeNum 1 or 2.
 * @returns {Photo[]}
 */
function parseDatabaseFile(content, volumeNum) {
  const photos = [];

  // Normalise line endings, split, trim, remove blank lines
  const lines = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // A path line starts with a drive letter followed by a colon and backslash
    // e.g.  f:\cdv2\a\mono
    if (/^[a-zA-Z]:[/\\]/.test(line)) {
      const subfolder = extractSubfolder(line);
      i++;

      if (i < lines.length) {
        const dataLine = lines[i];
        const photo = parseDataLine(dataLine, subfolder, volumeNum);
        if (photo) photos.push(photo);
      }
    }

    i++;
  }

  return photos;
}

/**
 * Strip the drive letter and the first path segment (the CD root folder).
 * "f:\cdv2\a\mono"  →  "a/mono"
 * "f:\cdv1\"        →  ""   (root itself)
 */
function extractSubfolder(pathLine) {
  // Normalise to forward slashes
  const normalised = pathLine.replace(/\\/g, '/');
  // Remove drive letter + colon at start:  "f:/" → ""
  const withoutDrive = normalised.replace(/^[a-zA-Z]:\//, '');
  // Split into parts; drop the first segment (CD root like "cdv2")
  const parts = withoutDrive.split('/').filter(p => p.length > 0);
  if (parts.length <= 1) return '';        // only the root segment, no subfolder
  return parts.slice(1).join('/');         // e.g. ["cdv2","a","mono"] → "a/mono"
}

/**
 * Parse a data line:
 *   JF0095.JPG     47439  Ivory Coast acrobats, Female, BackBend
 */
function parseDataLine(line, subfolder, volumeNum) {
  // Match: FILENAME.EXT  <whitespace>  digits  <whitespace>  rest
  const match = line.match(/^(\S+\.(?:jpe?g|png|gif|bmp|tiff?|webp))\s+(\d+)\s+(.+)$/i);
  if (!match) return null;

  const filename  = match[1];
  const filesize  = parseInt(match[2], 10);
  const metaRaw   = match[3].trim();

  // Metadata is comma-separated: performer, gender, category1[, category2 …]
  const metaParts = metaRaw.split(',').map(p => p.trim()).filter(p => p.length > 0);

  const performer  = metaParts[0] || '';
  const gender     = normaliseGender(metaParts[1] || '');
  const categories = metaParts.slice(2).map(normaliseCategory).filter(Boolean);

  return {
    id: `v${volumeNum}-${filename}`,
    filename,
    filesize,
    performer,
    gender,
    categories,
    subfolder,           // relative path inside the volume root
    volume: volumeNum,
    // localPath and galleryUrl are set later once the volume root is known
    localPath: null,
    galleryUrl: null
  };
}

function normaliseGender(raw) {
  const s = raw.trim().toLowerCase();
  if (s === 'female') return 'Female';
  if (s === 'male')   return 'Male';
  return raw.trim();
}

function normaliseCategory(raw) {
  return raw.trim();
}

// Make the parser available both as a plain module (for testing) and via a
// globally-injected script tag in the renderer HTML.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseDatabaseFile, extractSubfolder };
}
