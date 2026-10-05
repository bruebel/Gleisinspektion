// Fotos werden vor dem Speichern verkleinert: spart Platz auf dem Gerät und Zeit beim Hochladen.
const MAX_KANTE = 1600;
const QUALITAET = 0.8;

export async function komprimiereFoto(datei: File): Promise<Blob> {
  try {
    const bild = await createImageBitmap(datei, { imageOrientation: 'from-image' });
    const faktor = Math.min(1, MAX_KANTE / Math.max(bild.width, bild.height));
    const breite = Math.round(bild.width * faktor);
    const hoehe = Math.round(bild.height * faktor);
    const canvas = document.createElement('canvas');
    canvas.width = breite;
    canvas.height = hoehe;
    canvas.getContext('2d')!.drawImage(bild, 0, 0, breite, hoehe);
    bild.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', QUALITAET));
    return blob && blob.size < datei.size ? blob : datei;
  } catch {
    // Falls der Browser das Format nicht dekodieren kann, Original behalten.
    return datei;
  }
}
