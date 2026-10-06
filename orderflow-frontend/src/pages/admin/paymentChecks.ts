import { peso } from "../../api";

// Catches the slip where cash actually received gets typed into Discount (or
// Received is cleared). A prompt rather than a block: a real write-off or a
// genuine large discount is still possible.
export const paymentWarning = (received: number, discount: number, invoiceAmount: number): string | null => {
  if (discount > 0 && received === 0)
    return `Received is ${peso(0)} but Discount is ${peso(discount)}.\n\nIf that ${peso(discount)} is cash the client actually paid, it belongs in Received, not Discount.`;
  if (invoiceAmount > 0 && discount > invoiceAmount * 0.1)
    return `Discount is ${peso(discount)}, more than 10% of ${peso(invoiceAmount)}.`;
  return null;
};
