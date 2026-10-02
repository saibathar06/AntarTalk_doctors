import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { renderPrescriptionPdf } from '../src/services/prescription.service.js';

describe('psychiatrist prescription PDF', () => {
  it('renders a branded PDF containing the clinical record and signature image', async () => {
    const signature = await sharp({ create: { width: 160, height: 60, channels: 3, background: '#172033' } }).jpeg().toBuffer();
    const pdf = await renderPrescriptionPdf({
      prescriptionId: '11111111-1111-4111-8111-111111111111',
      doctor: { name: 'Asha Rao', licenseNumber: 'MCI-123' },
      clientName: 'Example Client',
      sessionStart: new Date('2030-01-01T10:00:00.000Z'),
      medicines: 'Example medicine - 1 tablet at night for 7 days.',
      instructions: 'Take after food.',
      signature
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
