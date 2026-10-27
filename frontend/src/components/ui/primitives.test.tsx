import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge } from './Badge';
import { Button } from './Button';
import { Chip } from './Chip';
import { Checkbox, Field, Input, Switch } from './Field';
import { Panel } from './Panel';
import { SegmentedControl } from './SegmentedControl';
import { TabList, TabPanel, Tabs } from './Tabs';
import { WindowSwitch, windowState } from './WindowSwitch';

afterEach(cleanup);

describe('window controls', () => {
  it('keeps a requested window on while explaining focus suppression', () => {
    const toggle = vi.fn<() => void>();
    const { rerender } = render(
      <WindowSwitch
        on
        icon="meter"
        label="DPS meter"
        state={windowState({ known: true, requested: true, held: true })}
        stacked
        onClick={toggle}
      />,
    );
    const control = screen.getByRole('switch', { name: 'DPS meter' });
    expect(control.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Auto-hidden')).toBeTruthy();
    expect(
      document.getElementById(control.getAttribute('aria-describedby')!)?.textContent,
    ).toContain('not focused');
    fireEvent.click(control);
    expect(toggle).toHaveBeenCalledOnce();
    rerender(
      <WindowSwitch
        on={false}
        icon="meter"
        label="DPS meter"
        state={windowState({ known: true, requested: false, held: true })}
        stacked
        onClick={toggle}
      />,
    );
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById(control.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Hidden',
    );
  });

  it('blocks toggling until checking and pending native changes finish', () => {
    const toggle = vi.fn<() => void>();
    render(
      <WindowSwitch
        on={false}
        icon="meter"
        label="DPS meter"
        state={windowState({ known: false, requested: false })}
        busy
        onClick={toggle}
      />,
    );
    const control = screen.getByRole('switch', { name: 'DPS meter' });
    expect(screen.getByText('Checking…', { selector: '[data-ui="window-state"]' })).toBeTruthy();
    fireEvent.click(control);
    expect(toggle).not.toHaveBeenCalled();
  });
});

describe('Button', () => {
  it('blocks clicks and reports busy while loading, keeping its label', () => {
    const onClick = vi.fn<() => void>();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults to type="button" and lets a later class override a default', () => {
    render(<Button className="px-0">Go</Button>);
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain('px-0');
    expect(button.className).not.toContain('px-3.5');
  });
});

describe('Chip', () => {
  it('toggles aria-pressed through onPressedChange', () => {
    function Filter() {
      const [on, setOn] = useState(false);
      return (
        <Chip pressed={on} onPressedChange={setOn} count={3}>
          Pinned
        </Chip>
      );
    }
    render(<Filter />);
    const chip = screen.getByRole('button', { name: /^Pinned/ });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('SegmentedControl', () => {
  it('names the group and marks the chosen option pressed', () => {
    const onChange = vi.fn<(value: 'a' | 'b') => void>();
    render(
      <SegmentedControl
        label="Mode"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Mode' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Alpha' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('Tabs', () => {
  it('moves selection and focus with the arrow keys and links tabs to panels', async () => {
    function Sections() {
      const [tab, setTab] = useState<'one' | 'two'>('one');
      return (
        <Tabs value={tab} onValueChange={setTab}>
          <TabList
            label="Sections"
            items={[
              { id: 'one', label: 'One' },
              { id: 'two', label: 'Two', badge: 2 },
            ]}
          />
          <TabPanel value="one">First</TabPanel>
          <TabPanel value="two">Second</TabPanel>
        </Tabs>
      );
    }
    render(<Sections />);
    const one = screen.getByRole('tab', { name: 'One' });
    expect(one.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'One' }).textContent).toBe('First');
    act(() => one.focus());
    fireEvent.keyDown(one, { key: 'ArrowRight' });
    const two = screen.getByRole('tab', { name: /^Two/ });
    await waitFor(() => expect(document.activeElement).toBe(two));
    expect(two.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: /^Two/ }).textContent).toBe('Second');
  });
});

describe('form controls', () => {
  it('wires a field label to its control and announces an error', () => {
    render(
      <Field label="Name" error="Required">
        {(id) => <Input id={id} />}
      </Field>,
    );
    expect(screen.getByLabelText('Name').tagName).toBe('INPUT');
    expect(screen.getByRole('alert').textContent).toBe('Required');
  });

  it('exposes a switch with its state and label', () => {
    const onChange = vi.fn<(checked: boolean) => void>();
    render(
      <Switch checked={false} onCheckedChange={onChange} label="Sound" hint="Plays a chime" />,
    );
    const control = screen.getByRole('switch', { name: /Sound/ });
    expect(control.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('labels a checkbox by its written text', () => {
    render(<Checkbox label="Party only" defaultChecked />);
    expect(screen.getByRole('checkbox', { name: 'Party only' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
});

describe('surfaces', () => {
  it('draws a glass panel with haloed text and no scheme of its own', () => {
    render(
      <Panel variant="glass" data-testid="glass">
        Meter
      </Panel>,
    );
    const glass = screen.getByTestId('glass');
    expect(glass.className).toContain('text-halo');
    expect(glass.hasAttribute('data-scheme')).toBe(false);
  });

  it('writes badges as words, with an optional decorative dot', () => {
    const { container } = render(
      <Badge tone="success" dot="live">
        Capturing
      </Badge>,
    );
    expect(container.textContent).toBe('Capturing');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
