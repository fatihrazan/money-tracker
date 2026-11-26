import {
  Banknote,
  Landmark,
  Smartphone,
  Tags,
  Utensils,
  ShoppingBag,
  Car,
  Receipt,
  HeartPulse,
  GraduationCap,
  Coffee,
  BriefcaseBusiness,
  Gift,
  Coins,
  Clapperboard,
} from 'lucide-react';
import { rupiah, type Account, type Category } from '@money/core';
import type { PickerOption } from './pickers';

export function accountOptions(accounts: Account[]): PickerOption[] {
  return accounts.map((account) => {
    const Icon =
      account.type === 'bank' ? Landmark : account.type === 'ewallet' ? Smartphone : Banknote;
    return {
      value: account.id,
      label: `${account.name}${account.archived ? ' (arsip)' : ''}`,
      description: rupiah(account.balance),
      icon: <Icon size={16} />,
      tone: account.type,
    };
  });
}
export function categoryOptions(categories: Category[]): PickerOption[] {
  return categories.map((category) => {
    const name = category.name.toLowerCase();
    const Icon = /kopi|ngopi/.test(name)
      ? Coffee
      : /makan|minum|jajan/.test(name)
        ? Utensils
        : /belanja/.test(name)
          ? ShoppingBag
          : /transport|bensin|parkir/.test(name)
            ? Car
            : /tagihan|admin/.test(name)
              ? Receipt
              : /kesehatan|obat/.test(name)
                ? HeartPulse
                : /pendidikan|kuliah/.test(name)
                  ? GraduationCap
                  : /gaji|bonus/.test(name)
                    ? BriefcaseBusiness
                    : /hadiah/.test(name)
                      ? Gift
                      : /cashback/.test(name)
                        ? Coins
                        : /hiburan/.test(name)
                          ? Clapperboard
                          : Tags;
    return {
      value: category.id,
      label: category.name,
      icon: <Icon size={16} />,
      tone: category.kind,
    };
  });
}
