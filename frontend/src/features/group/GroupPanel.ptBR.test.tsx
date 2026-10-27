import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationProvider } from '../../i18n/provider';
import { createTestI18n } from '../../i18n/testing';
import { GroupPanel } from './GroupPanel';
import type { GroupMemberData, GroupStatusData } from './model';

afterEach(cleanup);

const member = (name: string, extra: Partial<GroupMemberData> = {}): GroupMemberData => ({
  name,
  server_id: 1001,
  class: 'Ranger',
  level: 45,
  ...extra,
});
const status = (members: GroupMemberData[], extra: Partial<GroupStatusData> = {}) =>
  ({
    capture_id: 3,
    running: true,
    phase: 'capturing',
    message: '',
    roster_seen: true,
    roster_age_ms: 2000,
    members,
    inspections: [],
    ...extra,
  }) satisfies GroupStatusData;
const full = status(
  [
    member('ramtala', { gear_score: 2303, combat_power: 109681, ready: true, leader: true }),
    member('Diabolus', { class: 'Templar', gear_score: 1944, combat_power: 85680, ready: true }),
    member('foxyyyynm', { class: 'Cleric', gear_score: 2159, combat_power: 93799, ready: true }),
  ],
  { lobby_name: 'Deus Research Base (Transcendence)', capacity: 5 },
);

function renderIn(locale: 'en' | 'pt-BR', value: GroupStatusData) {
  const i18n = createTestI18n(locale);
  const wrap = (node: ReactNode) => <TranslationProvider i18n={i18n}>{node}</TranslationProvider>;
  const props = { native: true, error: '', onHide: vi.fn<() => void>() };
  const view = render(wrap(<GroupPanel status={value} {...props} />));
  return {
    i18n,
    view,
    rerender: (next: GroupStatusData) =>
      view.rerender(wrap(<GroupPanel status={next} {...props} />)),
  };
}
const members = () => within(screen.getByRole('list', { name: 'Membros do grupo' }));

describe('Group panel in Brazilian Portuguese', () => {
  it('words the roster in Portuguese with pt-BR numbers and observed names verbatim', () => {
    renderIn('pt-BR', full);
    expect(screen.getByRole('region', { name: 'Grupo' })).toBeTruthy();
    expect(screen.getByLabelText('3 de 5 membros').textContent).toBe('3/5');
    expect(screen.getByText('3 prontos')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Deus Research Base (Transcendence)' }),
    ).toBeTruthy();
    expect(members().getByText('ramtala')).toBeTruthy();
    expect(members().getByText('Templar')).toBeTruthy();
    expect(members().getAllByText('Líder do grupo')).toHaveLength(1);
    expect(members().getByText('GS 2.303 · Nv. 45')).toBeTruthy();
    expect(members().getByText('109.681')).toBeTruthy();
    expect(members().getAllByText('Pronto, horário não observado')).toHaveLength(3);
    expect(members().getAllByText('Vaga aberta')).toHaveLength(2);
    expect(screen.getByTitle('Poder de Combate médio').querySelector('b')?.textContent).toBe(
      '96.387',
    );
    expect(screen.getByRole('button', { name: 'Ocultar painel do Grupo' })).toBeTruthy();
  });

  it('pluralizes member and readiness counts for 0, 1 and 2', () => {
    const { rerender } = renderIn('pt-BR', status([], { roster_seen: false, roster_age_ms: null }));
    expect(screen.getByLabelText('0 membros, tamanho do grupo desconhecido')).toBeTruthy();
    expect(screen.getByText('Nenhum grupo observado ainda.')).toBeTruthy();
    expect(screen.getByText('Aguardando grupo')).toBeTruthy();

    rerender(status([member('Solo', { ready: true })]));
    expect(screen.getByLabelText('1 membro, tamanho do grupo desconhecido')).toBeTruthy();
    expect(screen.getByText('1 pronto')).toBeTruthy();

    rerender(status([member('Solo', { ready: true }), member('Duo', { ready: false })]));
    expect(screen.getByLabelText('2 membros, tamanho do grupo desconhecido')).toBeTruthy();
    expect(screen.getByText('1 pronto')).toBeTruthy();
    expect(members().getByText('Não pronto, horário não observado')).toBeTruthy();

    rerender(status([member('Solo', { ready: false }), member('Duo', { ready: false })]));
    expect(screen.getByText('0 prontos')).toBeTruthy();
  });

  it('shows the capture state from the shared words and keeps raw native errors verbatim', () => {
    renderIn('pt-BR', status([], { running: false, phase: 'error', message: 'Npcap unavailable' }));
    expect(screen.getByRole('status', { name: 'Erro do grupo' }).textContent).toBe(
      'Npcap unavailable',
    );
    expect(screen.getByText('Erro de captura')).toBeTruthy();
  });

  it('switches language in place without losing the find tools or the typed search', async () => {
    const { i18n } = renderIn('en', full);
    fireEvent.click(screen.getByRole('button', { name: 'Find & compare' }));
    fireEvent.change(screen.getByLabelText('Find group member'), { target: { value: 'ram' } });
    expect(screen.getByText('GS 2,303 · Lv 45')).toBeTruthy();

    await act(() => i18n.changeLanguage('pt-BR'));
    const search = screen.getByLabelText('Buscar membro do grupo');
    expect((search as HTMLInputElement).value).toBe('ram');
    expect(
      screen.getByRole('button', { name: 'Buscar e comparar' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(members().getAllByRole('listitem')).toHaveLength(1);
    expect(members().getByText('GS 2.303 · Nv. 45')).toBeTruthy();
    expect(screen.getByLabelText('Ordenar membros')).toBeTruthy();
  });
});
