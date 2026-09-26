import path from 'node:path';
import { readdir, stat, unlink } from 'node:fs/promises';
import { prisma } from '../lib/prisma.js';
import { uploadRoot } from '../services/upload.service.js';

// Dry run by default. Only generated filenames in UUID directories, never recursive removal.
const apply = process.argv.includes('--apply');
let candidates = 0;
try {
  const profiles = await prisma.doctorProfile.findMany({ select: { userId: true, profileImageUrl: true, licenseDocumentUrl: true } });
  const referenced = new Set(profiles.flatMap(profile => [profile.profileImageUrl, profile.licenseDocumentUrl].filter(Boolean).map(url => `${profile.userId}/${path.basename(url)}`)));
  for (const directory of await readdir(uploadRoot, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    if (!directory.isDirectory() || directory.isSymbolicLink() || !/^[a-f0-9-]{36}$/.test(directory.name)) continue;
    for (const file of await readdir(path.join(uploadRoot, directory.name), { withFileTypes: true })) {
      if (!file.isFile() || file.isSymbolicLink() || !/^[a-f0-9-]{36}\.(jpg|pdf)$/.test(file.name) || referenced.has(`${directory.name}/${file.name}`)) continue;
      const target = path.resolve(uploadRoot, directory.name, file.name);
      if (!target.startsWith(uploadRoot + path.sep)) throw new Error('Invalid upload path');
      if (Date.now() - (await stat(target)).mtimeMs < 86400000) continue;
      candidates += 1;
      if (apply) await unlink(target);
    }
  }
  console.log(JSON.stringify({ mode: apply ? 'removed' : 'dry-run', unreferencedFilesOlderThan24Hours: candidates }));
} finally { await prisma.$disconnect(); }
