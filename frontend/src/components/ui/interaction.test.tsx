import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Chip } from './Chip';
import { Disclosure } from './Disclosure';
import { Checkbox, Field, Input, Select, Switch } from './Field';
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from './Menu';
import { SegmentedControl } from './SegmentedControl';
import { TabList, TabPanel, Tabs } from './Tabs';

/*
 * Keyboard, focus, dismissal and ARIA wiring of the primitives built on Base UI. The looks
 * are covered by the design-system guardrail; these pin down how each one behaves.
 */

afterEach(cleanup);

/** Presses a key the way a keyboard does, on whatever has focus. */
function press(key: string, target: Element = document.activeElement ?? document.body) {
  fireEvent.keyDown(target, { key });
  fireEvent.keyUp(target, { key });
}

describe('Tabs', () => {
  function Sections({ keepMounted = false }: { keepMounted?: boolean }) {
    const [tab, setTab] = useState<'one' | 'two' | 'three' | 'four'>('one');
    return (
      <Tabs value={tab} onValueChange={setTab}>
        <TabList
          label="Sections"
          items={[
            { id: 'one', label: 'One' },
            { id: 'two', label: 'Two' },
            { id: 'three', label: 'Three', disabled: true },
            { id: 'four', label: 'Four' },
          ]}
        />
        <TabPanel value="one" keepMounted={keepMounted}>
          First
        </TabPanel>
        <TabPanel value="two">Second</TabPanel>
        <TabPanel value="four">Fourth</TabPanel>
      </Tabs>
    );
  }
  const tab = (name: string) => screen.getByRole('tab', { name });

  it('is one tab stop that links each tab to its panel', () => {
    render(<Sections />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeTruthy();
    expect(tab('One').getAttribute('tabindex')).toBe('0');
    expect(tab('Two').getAttribute('tabindex')).toBe('-1');
    const panel = screen.getByRole('tabpanel', { name: 'One' });
    expect(tab('One').getAttribute('aria-controls')).toBe(panel.id);
    // The panel leads with its own content, so it is not a tab stop of its own.
    expect(panel.getAttribute('tabindex')).toBe('-1');
  });

  it('chooses with the arrow keys, Home and End, and only reads a disabled tab', async () => {
    render(<Sections />);
    act(() => tab('One').focus());
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(tab('Two')));
    expect(tab('Two').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Two' }).textContent).toBe('Second');
    // A disabled tab can be reached and read, but it is never chosen.
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(tab('Three')));
    expect(tab('Three').getAttribute('aria-disabled')).toBe('true');
    expect(tab('Two').getAttribute('aria-selected')).toBe('true');
    press('ArrowRight');
    await waitFor(() => expect(tab('Four').getAttribute('aria-selected')).toBe('true'));
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(tab('One')));
    press('End');
    await waitFor(() => expect(tab('Four').getAttribute('aria-selected')).toBe('true'));
    press('Home');
    await waitFor(() => expect(tab('One').getAttribute('aria-selected')).toBe('true'));
  });

  it('keeps a mounted panel hidden, out of the accessibility tree, while another is shown', () => {
    render(<Sections keepMounted />);
    fireEvent.click(tab('Two'));
    const kept = screen.getByText('First');
    expect(kept.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true);
    expect(screen.queryByRole('tabpanel', { name: 'One' })).toBeNull();
    expect(screen.getByRole('tabpanel', { name: 'Two' })).toBeTruthy();
  });
});

describe('SegmentedControl', () => {
  function Mode({ onChange }: { onChange: (value: string) => void }) {
    const [value, setValue] = useState<'a' | 'b' | 'c'>('a');
    return (
      <SegmentedControl
        label="Mode"
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        segmentAttributes={{ 'data-hit': '' }}
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
          { value: 'c', label: 'Gamma', disabled: true },
        ]}
      />
    );
  }

  it('is one tab stop whose arrow keys move between the segments', async () => {
    render(<Mode onChange={vi.fn<(value: string) => void>()} />);
    const group = screen.getByRole('group', { name: 'Mode' });
    const [alpha, beta] = within(group).getAllByRole('button');
    expect(alpha!.getAttribute('tabindex')).toBe('0');
    expect(beta!.getAttribute('tabindex')).toBe('-1');
    expect(beta!.hasAttribute('data-hit')).toBe(true);
    act(() => alpha!.focus());
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(beta));
    // Moving focus never chooses; pressing does.
    expect(beta!.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the chosen segment chosen when it is pressed again', () => {
    const onChange = vi.fn<(value: string) => void>();
    render(<Mode onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Alpha' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(onChange).toHaveBeenLastCalledWith('b');
    expect(screen.getByRole('button', { name: 'Beta' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Gamma' }).disabled).toBe(true);
  });
});

describe('Chip and Button', () => {
  it('reports a plain chip as a button and a pressed chip as a toggle', () => {
    const onClick = vi.fn<() => void>();
    render(
      <>
        <Chip onClick={onClick}>Reset</Chip>
        <Chip pressed onPressedChange={vi.fn<(pressed: boolean) => void>()}>
          Pinned
        </Chip>
      </>,
    );
    const plain = screen.getByRole('button', { name: 'Reset' });
    expect(plain.hasAttribute('aria-pressed')).toBe(false);
    fireEvent.click(plain);
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Pinned' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('keeps native button semantics, so a form still submits', () => {
    const onSubmit = vi.fn<(event: SubmitEvent) => void>((event) => event.preventDefault());
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
        <Button type="submit">Save</Button>
      </form>,
    );
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.tagName).toBe('BUTTON');
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe('Switch and Checkbox', () => {
  it('toggles a switch by its label, by Space and by Enter, and not while disabled', () => {
    function Sound({ disabled = false }: { disabled?: boolean }) {
      const [on, setOn] = useState(false);
      return <Switch checked={on} onCheckedChange={setOn} label="Sound" disabled={disabled} />;
    }
    const { unmount } = render(<Sound />);
    const control = screen.getByRole('switch', { name: 'Sound' });
    expect(control.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByText('Sound'));
    expect(control.getAttribute('aria-checked')).toBe('true');
    act(() => control.focus());
    press(' ');
    expect(control.getAttribute('aria-checked')).toBe('false');
    press('Enter');
    expect(control.getAttribute('aria-checked')).toBe('true');
    unmount();
    render(<Sound disabled />);
    const off = screen.getByRole('switch', { name: 'Sound' });
    expect(off.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(off);
    expect(off.getAttribute('aria-checked')).toBe('false');
  });

  it('reports a mixed checkbox and reads the next state from onCheckedChange', () => {
    const onCheckedChange = vi.fn<(checked: boolean) => void>();
    render(
      <Checkbox
        aria-label="Mark Supply complete"
        checked={false}
        indeterminate
        onCheckedChange={onCheckedChange}
      />,
    );
    const box = screen.getByRole('checkbox', { name: 'Mark Supply complete' });
    expect(box.getAttribute('aria-checked')).toBe('mixed');
    act(() => box.focus());
    press(' ');
    expect(onCheckedChange).toHaveBeenCalledOnce();
    expect(onCheckedChange.mock.lastCall?.[0]).toBe(true);
  });
});

describe('Field', () => {
  it('labels its control and describes it by the hint, then by an announced error', () => {
    const { rerender } = render(
      <Field label="Name" hint="Shown in the list">
        {(id) => <Input id={id} />}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    const hint = screen.getByText('Shown in the list');
    expect(input.getAttribute('aria-describedby')).toContain(hint.id);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    rerender(
      <Field label="Name" hint="Shown in the list" error="Required">
        {(id) => <Input id={id} />}
      </Field>,
    );
    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('Required');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(error.id);
  });

  it('labels a native select and lets a helper input keep its own name', () => {
    const onChange = vi.fn<(value: string) => void>();
    render(
      <Field label="Boss">
        {(id) => (
          <>
            <Input aria-label="Search bosses" />
            <Select id={id} value="1" onChange={(event) => onChange(event.target.value)}>
              <option value="1">Golem</option>
              <option value="2">Drake</option>
            </Select>
          </>
        )}
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: 'Search bosses' })).toBeTruthy();
    const select = screen.getByRole('combobox', { name: 'Boss' });
    fireEvent.change(select, { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith('2');
  });
});

describe('Disclosure', () => {
  it('is a button that unfolds its panel, keeping closed content findable', () => {
    render(
      <Disclosure summary="Technical details" summaryAttributes={{ 'data-hit': 'about' }}>
        Raw native detail
      </Disclosure>,
    );
    const toggle = screen.getByRole('button', { name: 'Technical details' });
    expect(toggle.getAttribute('data-hit')).toBe('about');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const panel = screen.getByText('Raw native detail').closest('[hidden]');
    expect(panel?.getAttribute('hidden')).toBe('until-found');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(
      screen.getByText('Raw native detail').closest('[id]')?.id,
    );
  });

  it('re-applies a changed open prop but lets the reader fold it in between', () => {
    const { rerender } = render(
      <Disclosure summary="Fallback" open>
        Body
      </Disclosure>,
    );
    const toggle = screen.getByRole('button', { name: 'Fallback' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    rerender(
      <Disclosure summary="Fallback" open>
        Body
      </Disclosure>,
    );
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    rerender(
      <Disclosure summary="Fallback" open={false}>
        Body
      </Disclosure>,
    );
    rerender(
      <Disclosure summary="Fallback" open>
        Body
      </Disclosure>,
    );
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('Menu', () => {
  function Picker({ onPick }: { onPick: (value: string) => void }) {
    const [value, setValue] = useState('live');
    const sheet = useRef<HTMLDivElement>(null);
    return (
      <div ref={sheet} data-testid="sheet">
        <Menu modal={false}>
          <MenuTrigger render={<Button data-hit />}>History</MenuTrigger>
          <MenuPopup container={sheet} aria-label="Fight history">
            <MenuRadioGroup
              value={value}
              onValueChange={(next: string) => {
                setValue(next);
                onPick(next);
              }}
            >
              <MenuRadioItem value="live" data-hit>
                Current fight
              </MenuRadioItem>
              <MenuRadioItem value="golem" data-hit>
                Golem run
              </MenuRadioItem>
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
        <button type="button">Elsewhere</button>
      </div>
    );
  }

  it('opens from its trigger inside the given container, with the choice checked', async () => {
    render(<Picker onPick={vi.fn<(value: string) => void>()} />);
    const trigger = screen.getByRole('button', { name: 'History' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    const menu = await screen.findByRole('menu', { name: 'Fight history' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('sheet').contains(menu)).toBe(true);
    const current = within(menu).getByRole('menuitemradio', { name: 'Current fight' });
    expect(current.getAttribute('aria-checked')).toBe('true');
    expect(current.hasAttribute('data-hit')).toBe(true);
  });

  it('moves with the arrow keys and closes on Escape, giving focus back to the trigger', async () => {
    render(<Picker onPick={vi.fn<(value: string) => void>()} />);
    const trigger = screen.getByRole('button', { name: 'History' });
    act(() => trigger.focus());
    press('ArrowDown', trigger);
    const menu = await screen.findByRole('menu', { name: 'Fight history' });
    const [current, golem] = within(menu).getAllByRole('menuitemradio');
    await waitFor(() => expect(document.activeElement).toBe(current));
    press('ArrowDown');
    await waitFor(() => expect(document.activeElement).toBe(golem));
    press('Escape');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when a choice is made or the pointer presses outside it', async () => {
    const onPick = vi.fn<(value: string) => void>();
    render(<Picker onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Golem run' }));
    expect(onPick).toHaveBeenCalledWith('golem');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    await screen.findByRole('menu');
    const outside = screen.getByRole('button', { name: 'Elsewhere' });
    fireEvent.pointerDown(outside);
    fireEvent.mouseDown(outside);
    fireEvent.click(outside);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});
