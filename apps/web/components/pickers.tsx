'use client';

import { useId, useState, type ReactNode } from 'react';
import * as Select from '@radix-ui/react-select';
import * as Popover from '@radix-ui/react-popover';
import { DayPicker } from '@daypicker/react';
import { id } from '@daypicker/react/locale';
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  X,
} from 'lucide-react';
import { today } from '@money/core';

export type PickerOption = {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: ReactNode;
  description?: string;
  tone?: string;
};
const EMPTY = '__empty_option__';

export function SelectField({
  name,
  label,
  options,
  value,
  defaultValue = '',
  onValueChange,
  required = false,
  placeholder = 'Pilih',
  disabled = false,
  compact = false,
}: {
  name?: string;
  label: string;
  options: PickerOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [internal, setInternal] = useState(defaultValue);
  const current = value ?? internal;
  const allowEmpty = !required && options.some((option) => option.value === '');
  const selected = options.find((option) => option.value === current);
  const rich = options.some((option) => option.icon || option.description);
  return (
    <Select.Root
      name={name}
      value={current === '' && allowEmpty ? EMPTY : current}
      required={required}
      disabled={disabled || options.length === 0}
      onValueChange={(next) => {
        const selected = next === EMPTY ? '' : next;
        setInternal(selected);
        onValueChange?.(selected);
      }}
    >
      <Select.Trigger
        className={`picker-trigger${compact ? ' compact' : ''}${rich ? ' rich-picker' : ''}`}
        aria-label={label}
      >
        <Select.Value placeholder={placeholder}>
          {selected && (
            <span className="picker-value">
              {selected.icon && (
                <span className="picker-mark" data-tone={selected.tone} aria-hidden="true">
                  {selected.icon}
                </span>
              )}
              <span>{selected.label}</span>
            </span>
          )}
        </Select.Value>
        <Select.Icon className="picker-chevron">
          <ChevronDown size={16} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="select-panel"
          position="popper"
          sideOffset={7}
          collisionPadding={12}
          data-rich={rich}
        >
          <Select.ScrollUpButton className="select-scroll">
            <ChevronUp size={15} />
          </Select.ScrollUpButton>
          <Select.Viewport className="select-viewport">
            {options
              .filter((option) => option.value !== '' || allowEmpty)
              .map((option) => (
                <Select.Item
                  className="select-option"
                  key={option.value}
                  value={option.value || EMPTY}
                  disabled={option.disabled}
                  textValue={option.label}
                  aria-label={option.label}
                  aria-description={option.description}
                >
                  {option.icon && (
                    <span className="picker-mark" data-tone={option.tone} aria-hidden="true">
                      {option.icon}
                    </span>
                  )}
                  <span className="select-copy">
                    <Select.ItemText>{option.label}</Select.ItemText>
                    {option.description && <small>{option.description}</small>}
                  </span>
                  <Select.ItemIndicator className="select-check">
                    <Check size={16} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="select-scroll">
            <ChevronDown size={15} />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function localDate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}
function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const months = Array.from({ length: 12 }, (_, month) => ({
  value: String(month),
  label: new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(new Date(2026, month, 1)),
}));

export function DateField({
  name,
  defaultValue = today(),
  label = 'Tanggal',
  value: controlledValue,
  onValueChange,
}: {
  name: string;
  defaultValue?: string;
  label?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  const [internalValue, setValue] = useState(defaultValue);
  const value = controlledValue ?? internalValue;
  const [month, setMonth] = useState(localDate(value || today()));
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const selected = value ? localDate(value) : undefined;
  const year = month.getFullYear();
  const firstYear = Math.max(1900, Math.min(new Date().getFullYear() - 100, year - 20));
  const lastYear = Math.min(9998, Math.max(new Date().getFullYear() + 10, year + 10));
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => ({
    value: String(firstYear + i),
    label: String(firstYear + i),
  })).reverse();
  function choose(date: Date) {
    setValue(dateValue(date));
    onValueChange?.(dateValue(date));
    setMonth(date);
    setOpen(false);
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setMonth(selected ?? localDate(today()));
      }}
    >
      <input type="hidden" name={name} value={value} />
      <Popover.Trigger asChild>
        <button type="button" className="picker-trigger date-trigger" aria-label={label}>
          <span className="picker-value">
            <span className="picker-mark" aria-hidden="true">
              <CalendarDays size={16} />
            </span>
            <span>
              {selected
                ? new Intl.DateTimeFormat('id-ID', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  }).format(selected)
                : 'Pilih tanggal'}
            </span>
          </span>
          <ChevronDown className="date-chevron" size={16} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="calendar-panel"
          sideOffset={8}
          align="end"
          collisionPadding={12}
          aria-labelledby={titleId}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="calendar-heading">
            <h3 id={titleId}>Pilih tanggal</h3>
            <Popover.Close asChild>
              <button type="button" className="icon-button" aria-label="Tutup kalender">
                <X size={16} />
              </button>
            </Popover.Close>
          </div>
          <div className="calendar-toolbar">
            <SelectField
              label="Bulan"
              value={String(month.getMonth())}
              options={months}
              compact
              onValueChange={(next) => setMonth(new Date(year, Number(next), 1, 12))}
            />
            <SelectField
              label="Tahun"
              value={String(year)}
              options={years}
              compact
              onValueChange={(next) => setMonth(new Date(Number(next), month.getMonth(), 1, 12))}
            />
            <div className="calendar-arrows">
              <button
                type="button"
                className="icon-button"
                aria-label="Bulan sebelumnya"
                disabled={year === 1900 && month.getMonth() === 0}
                onClick={() => setMonth(new Date(year, month.getMonth() - 1, 1, 12))}
              >
                <ChevronLeft size={17} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Bulan berikutnya"
                disabled={year === 9998 && month.getMonth() === 11}
                onClick={() => setMonth(new Date(year, month.getMonth() + 1, 1, 12))}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
          <DayPicker
            className="themed-calendar"
            mode="single"
            locale={id}
            weekStartsOn={1}
            required
            autoFocus
            selected={selected}
            month={month}
            onMonthChange={setMonth}
            onSelect={choose}
            hideNavigation
            showOutsideDays
            fixedWeeks
            startMonth={new Date(1900, 0, 1)}
            endMonth={new Date(9998, 11, 31)}
            today={localDate(today())}
            classNames={{
              root: 'calendar-grid',
              months: 'calendar-months',
              month: 'calendar-month',
              month_caption: 'sr-only',
              month_grid: 'calendar-table',
              weekdays: 'calendar-weekdays',
              weekday: 'calendar-weekday',
              weeks: 'calendar-weeks',
              week: 'calendar-week',
              day: 'calendar-day',
              day_button: 'calendar-day-button',
              selected: 'is-selected',
              today: 'is-today',
              outside: 'is-outside',
              disabled: 'is-disabled',
              hidden: 'is-hidden',
            }}
          />
          <div className="calendar-footer">
            <button type="button" onClick={() => choose(localDate(today()))}>
              Hari ini
            </button>
            <Popover.Close asChild>
              <button type="button">Tutup</button>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
