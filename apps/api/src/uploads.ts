import { BadRequestException, Logger, PayloadTooLargeException } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { UPLOAD_LIMITS } from '@leave/contracts';

export interface UploadedAsset {
  buffer: Buffer;
  originalname: string;
}

async function identify(file: UploadedAsset | undefined, limit: number, allowed: string[]) {
  if (!file || !file.buffer.length) throw new BadRequestException('Choose a file to upload.');
  if (file.buffer.length > limit) throw new PayloadTooLargeException('The selected file exceeds the upload size limit.');
  let type;
  try {
    type = await fileTypeFromBuffer(file.buffer);
  } catch (error) {
    if (error instanceof Error && error.name === 'EndOfStreamError') throw new BadRequestException('The uploaded file is incomplete or corrupt.');
    throw error;
  }
  if (!type || !allowed.includes(type.mime)) throw new BadRequestException(`Unsupported file content. Allowed types: ${allowed.join(', ')}.`);
  return { file, type };
}

export async function profileImage(file: UploadedAsset | undefined): Promise<Buffer> {
  const valid = await identify(file, UPLOAD_LIMITS.photoBytes, ['image/jpeg', 'image/png', 'image/webp']);
  try {
    return await sharp(valid.file.buffer, { limitInputPixels: 20_000_000 })
      .rotate().resize(256, 256, { fit: 'cover', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  } catch {
    Logger.warn('Rejected a profile image that could not be safely decoded.', 'Uploads');
    throw new BadRequestException('The profile image could not be decoded. Choose a valid JPEG, PNG, or WebP image.');
  }
}

export async function supportingDocument(file: UploadedAsset) {
  const { type } = await identify(file, UPLOAD_LIMITS.documentBytes, ['application/pdf', 'image/jpeg', 'image/png']);
  // oxlint-disable-next-line no-control-regex -- Uploaded filenames must not contain control characters.
  const safeName = file.originalname.replace(/[\u0000-\u001f\u007f/\\]/g, '_').replace(/^\.+/, '').slice(0, 100);
  const stem = safeName.replace(/\.[^.]*$/, '') || 'document';
  return { filename: `${stem}.${type.ext}`, mimeType: type.mime, content: file.buffer };
}
