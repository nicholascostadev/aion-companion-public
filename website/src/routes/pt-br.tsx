import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/page';
import { pageHead } from '@/lib/head';

export const Route = createFileRoute('/pt-br')({
  head: () => pageHead('pt-BR'),
  component: () => <Page locale="pt-BR" />,
});
