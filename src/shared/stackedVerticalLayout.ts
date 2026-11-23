export interface StackedCropDimensions {
  widthPx: number;
  heightPx: number;
}

export interface StackedCropRect extends StackedCropDimensions {
  xPx: number;
  yPx: number;
}

export function calculateStackedCrop(widthPx: number, heightPx: number): StackedCropDimensions {
  const panelAspectRatio = 1080 / 960;
  let cropWidth = Math.min(widthPx, Math.round(heightPx * panelAspectRatio));
  let cropHeight = heightPx;

  if (cropWidth / cropHeight < panelAspectRatio) {
    cropWidth = widthPx;
    cropHeight = Math.round(widthPx / panelAspectRatio);
  }

  return {
    widthPx: makeEven(Math.min(widthPx, cropWidth)),
    heightPx: makeEven(Math.min(heightPx, cropHeight))
  };
}

export function calculateStackedCropRect(
  widthPx: number,
  heightPx: number,
  scale: number,
  focusX: number,
  focusY: number
): StackedCropRect {
  const baseCrop = calculateStackedCrop(widthPx, heightPx);
  const safeScale = clamp(scale, 0.25, 1);
  const safeFocusX = clamp(focusX, 0, 1);
  const safeFocusY = clamp(focusY, 0, 1);
  const cropWidth = Math.min(baseCrop.widthPx, makeEven(baseCrop.widthPx * safeScale));
  const cropHeight = Math.min(baseCrop.heightPx, makeEven(baseCrop.heightPx * safeScale));

  return {
    widthPx: cropWidth,
    heightPx: cropHeight,
    xPx: Math.min(Math.max(0, widthPx - cropWidth), Math.round(Math.max(0, widthPx - cropWidth) * safeFocusX)),
    yPx: Math.min(Math.max(0, heightPx - cropHeight), Math.round(Math.max(0, heightPx - cropHeight) * safeFocusY))
  };
}

function makeEven(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function clamp(value: number, minimum: number, maximum: number): number {
  const safeValue = Number.isFinite(value) ? value : (minimum + maximum) / 2;
  return Math.min(maximum, Math.max(minimum, safeValue));
}
