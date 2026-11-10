import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/page';
import { pageHead } from '@/lib/head';

export const Route = createFileRoute('/')({
  head: () => pageHead('en'),
  component: () => <Page locale="en" />,
});
