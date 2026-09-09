import fs from 'fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export function compareImages(
  referencePath: string,
  actualPath: string,
  diffPath: string
) {
  const reference = PNG.sync.read(
    fs.readFileSync(referencePath)
  );

  const actual = PNG.sync.read(
    fs.readFileSync(actualPath)
  );

  console.log('\nIMAGE SIZES:');
  console.log(
    `Reference: ${reference.width}x${reference.height}`
  );
  console.log(
    `Actual:    ${actual.width}x${actual.height}`
  );

  /*
   * We intentionally don't fail when heights differ.
   *
   * Figma and the real page can have different total heights.
   * Instead we compare the overlapping area.
   */

  const width = Math.min(
    reference.width,
    actual.width
  );

  const height = Math.min(
    reference.height,
    actual.height
  );

  const referenceCrop = new PNG({
    width,
    height,
  });

  const actualCrop = new PNG({
    width,
    height,
  });

  PNG.bitblt(
    reference,
    referenceCrop,
    0,
    0,
    width,
    height,
    0,
    0
  );

  PNG.bitblt(
    actual,
    actualCrop,
    0,
    0,
    width,
    height,
    0,
    0
  );

  const diff = new PNG({
    width,
    height,
  });

  const mismatchedPixels = pixelmatch(
    referenceCrop.data,
    actualCrop.data,
    diff.data,
    width,
    height,
    {
      threshold: 0.1,
      includeAA: false,
    }
  );

  fs.writeFileSync(
    diffPath,
    PNG.sync.write(diff)
  );

  const totalPixels =
    width * height;

  const mismatchPercentage =
    (mismatchedPixels / totalPixels) * 100;

  return {
    referenceWidth: reference.width,
    referenceHeight: reference.height,

    actualWidth: actual.width,
    actualHeight: actual.height,

    comparedWidth: width,
    comparedHeight: height,

    mismatchedPixels,
    totalPixels,

    mismatchPercentage,
  };
}