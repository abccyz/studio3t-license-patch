const glob = require('glob');
const childProcess = require('child_process');
const fs = require('fs');
const findInFiles = require('find-in-files');
const JSZip = require('jszip');

const newPublicCertBytes = [25, 115, 35, 44, -25, -66, -48, 89, 122, 66, -42, 113, -105, 84, -21, -13, -94, -90, -23, 117];
const oldPublicCertBytes = [119, -73, -20, -63, 110, -113, -5, -83, 102, 127, -33, 30, 122, -78, -77, -67, 127, -80, -125, -104];

(async () => {
  const pathToJarWithCodeNeedsToBePatched = glob.sync('./Studio 3T.app/**/data-man-mongodb*')[0];
  if (!pathToJarWithCodeNeedsToBePatched) { console.error('not found'); process.exit(1); }
  if (fs.existsSync('./Studio 3T Patched.app')) childProcess.execSync('rm -rf ./Studio 3T Patched.app', { stdio: 'inherit' });
  if (fs.existsSync('./disassembled')) childProcess.execSync('rm -rf ./disassembled', { stdio: 'inherit' });
  if (fs.existsSync('./assembledClass')) childProcess.execSync('rm -rf ./assembledClass', { stdio: 'inherit' });
  console.log('disassembling');
  childProcess.execSync(`python "Krakatau/disassemble.py" -out disassembled -roundtrip "${pathToJarWithCodeNeedsToBePatched}"`, { stdio: 'ignore' });
  console.log('disassembled');

  console.log('searching');
  const matchingFiles = await findInFiles.find('licensing_public.cer', './disassembled', '.j');
  const matchingFilesArray = Object.keys(matchingFiles);
  // const filesArr = ['disassembled/t3/common/lic/a/g.j']
  if (matchingFilesArray.length > 1) { console.error('Found more than one matching file to be processed.'); process.exit(1); }
  if (!matchingFilesArray.length) { console.error('Not found matching file to be processed.'); process.exit(1); }
  console.log('found file');
  const matchingFileContent = String(fs.readFileSync(matchingFilesArray[0]));

  const matchingFileContentSingleLine = matchingFileContent.replace(/\n/g, '--newline--');
  const disassembledMethods = [...matchingFileContentSingleLine.matchAll(/method(?:\s+)?(.*?)(?:\s+)?end method/g)];
  const matchingMethodsBySize = disassembledMethods.filter((method) => method[0].length > 2000 && method[0].length < 3000);
  const matchingMethodsByArrayLength = matchingMethodsBySize.filter((method) => [...method[0].matchAll(/bastore/g)].length === 20);
  const matchingMethods = matchingMethodsByArrayLength.filter((method) => oldPublicCertBytes.filter((oldPublicCertByte) => method[0].includes(`bipush ${oldPublicCertByte}`)).length > 15); /* find at least 15 matches of bytes to assume we found a method */
  if (matchingMethods.length > 1) { console.error('WTF, we found more than one method. It is impossible.'); process.exit(1); }
  if (!matchingMethods.length) { console.error('Not found method with public cert bytes(('); process.exit(1); }
  console.log('found method to be processed');
  const matchingMethod = matchingMethods[0];
  const matchingMethodStrWithNewlines = matchingMethod[0].replace(/--newline--/g, '\n');
  const matchingMethodStrLines = matchingMethodStrWithNewlines.split('\n');
  const patchedMethodLines = [...matchingMethodStrLines];
  const indexOfNewArrayOpCode = matchingMethodStrLines.findIndex((line) => line.includes('newarray byte'));
  const firstIndexOfBiPushOpCode = matchingMethodStrLines.findIndex((line, index) => index > indexOfNewArrayOpCode && line.includes('bipush'));
  let publicCertByteIndex = 0;
  for (let currentMethodLineIndex = firstIndexOfBiPushOpCode; currentMethodLineIndex < matchingMethodStrLines.length; currentMethodLineIndex++) {
    if (publicCertByteIndex < 20) patchedMethodLines[currentMethodLineIndex] = patchedMethodLines[currentMethodLineIndex].replace(/(L[0-9]+:\s+)(.*) /, `$1bipush ${newPublicCertBytes[publicCertByteIndex]} `);
    publicCertByteIndex += 1;
    currentMethodLineIndex += 3;
  }
  console.log('patched method');
  const originalMethodStr = matchingMethodStrLines.join('\n');
  const patchedMethodStr = patchedMethodLines.join('\n');
  fs.writeFileSync(matchingFilesArray[0], matchingFileContent.replace(originalMethodStr, patchedMethodStr));
  const originalJarBuffer = fs.readFileSync(pathToJarWithCodeNeedsToBePatched);
  const zip = new JSZip();
  console.log('loading zip');
  await zip.loadAsync(originalJarBuffer);
  console.log('loaded zip');
  console.log('assembling');
  childProcess.execSync(`python "Krakatau/assemble.py" -out assembledClass ${matchingFilesArray[0]}`, { stdio: 'ignore' });
  console.log('assembled');
  const compiledClassFsPath = glob.sync('./assembledClass/**/*.class')[0];
  const compiledClassDataBuffer = fs.readFileSync(compiledClassFsPath);
  const archiveClassPath = matchingFilesArray[0].replace('disassembled/', '').replace('.j', '.class');
  console.log('found patched file');
  await zip.file(archiveClassPath, compiledClassDataBuffer);
  const newCertFileBuffer = fs.readFileSync('./licensing_public.cer');
  await zip.file('t3/common/lic/licensing_public.cer', newCertFileBuffer);
  console.log('generating new zip');
  await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: {
      level: 6,
    },
  })
    .then((content) => fs.writeFileSync('assembled.jar', content));
  console.log('generated');
  // child_process.execSync(`python "Krakatau/assemble.py" -out assembled.jar -r disassembled/`, { stdio: 'inherit' })
  console.log('copying studio3t');
  childProcess.execSync('cp -R "./Studio 3T.app" "./Studio 3T Patched.app"', { stdio: 'inherit' });
  console.log('copied');
  fs.renameSync('./assembled.jar', pathToJarWithCodeNeedsToBePatched.replace('Studio 3T.app', 'Studio 3T Patched.app'));
  console.log('telling mac os that app can be opened');
  childProcess.execSync('xattr -r -d com.apple.quarantine "./Studio 3T Patched.app"', { stdio: 'inherit' });
  console.log('done');
})();