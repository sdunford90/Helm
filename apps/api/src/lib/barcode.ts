/**
 * ZPL barcode label generation for Zebra label printers.
 * Generates ZPL II format strings for standard 2" x 1" labels.
 */

export function generateZplLabel(params: {
  productName: string;
  sku: string;
  barcode: string;
  price: string;
}): string {
  const { productName, sku, barcode, price } = params;

  // Truncate product name to fit on 2" label (~25 chars at font size used)
  const truncatedName =
    productName.length > 28 ? productName.substring(0, 25) + '...' : productName;

  // ZPL II format for a 2" x 1" label (203 dpi = ~406 dots wide x 203 dots tall)
  const zpl = [
    '^XA', // Start format

    // Set label dimensions: 2" x 1" at 203 dpi
    '^PW406', // Print width 406 dots
    '^LL203', // Label length 203 dots

    // Product name at top
    '^FO20,15', // Field origin: x=20, y=15
    '^A0N,28,28', // Font: default, 28 dots high
    `^FD${truncatedName}^FS`, // Field data

    // Code 128 barcode in center
    '^FO30,50', // Field origin
    '^BY2', // Bar code defaults: module width 2
    '^BCN,60,Y,N,N', // Code 128: normal orientation, 60 dots tall, print interpretation line
    `^FD${barcode}^FS`, // Field data

    // SKU on bottom left
    '^FO20,160', // Field origin
    '^A0N,22,22', // Smaller font
    `^FDSKU: ${sku}^FS`, // Field data

    // Price on bottom right
    '^FO280,155', // Field origin
    '^A0N,30,30', // Slightly larger font for price
    `^FD${price}^FS`, // Field data

    '^XZ', // End format
  ].join('\n');

  return zpl;
}

export function generateBatchLabels(
  products: Array<{ name: string; sku: string; barcode: string; price: string }>
): string {
  if (products.length === 0) {
    return '';
  }

  // Combine all labels into a single ZPL job
  // Each label is a complete ^XA...^XZ block; the printer processes them sequentially
  const labels = products.map((product) =>
    generateZplLabel({
      productName: product.name,
      sku: product.sku,
      barcode: product.barcode,
      price: product.price,
    })
  );

  return labels.join('\n');
}
