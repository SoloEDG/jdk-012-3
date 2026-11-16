/** 浏览器端图片工具：编码、解码、画布合成。测试环境不依赖本模块。 */

export function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("画布编码失败"));
        return;
      }
      blob
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(reject);
    }, "image/png");
  });
}

/** 校验图片字节可解码；成功即释放位图（核验用途，不持有大资源） */
export async function verifyImageDecodable(
  bytes: Uint8Array,
  mime: string,
): Promise<void> {
  const bitmap = await createImageBitmap(
    new Blob([bytes as BlobPart], { type: mime }),
  );
  bitmap.close();
}

export async function decodeToBitmap(
  bytes: Uint8Array,
  mime: string,
): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
}

/** 把位图画到带留白衬底的画布上（统一装裱效果），并生成 DOM 预览 URL */
export function composeArtworkCanvas(
  bitmap: ImageBitmap,
): { canvas: HTMLCanvasElement; previewUrl: string } {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#ece8dd";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0);
  const previewUrl = canvas.toDataURL("image/jpeg", 0.82);
  return { canvas, previewUrl };
}
