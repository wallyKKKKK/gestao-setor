import type { Metadata } from 'next';
import { SupplierQuotationPortal } from '@/app/components/supplier-quotation-portal';

export const metadata: Metadata = {
  title: 'Responder cotação de compras',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function SupplierQuotationPage() {
  return <SupplierQuotationPortal />;
}
