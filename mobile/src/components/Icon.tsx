import React from 'react';
import type {ViewStyle, StyleProp} from 'react-native';
import {
  Plus,
  Minus,
  X,
  XCircle,
  Search,
  Settings,
  Clock,
  Trash2,
  TrendingUp,
  Fingerprint,
  CloudOff,
  Camera,
  Coffee,
  Box,
  Folder,
  Globe,
  ShoppingCart,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Tag,
  MapPin,
  User,
  Users,
  Receipt,
  BarChart3,
  Activity,
  Barcode,
  KeyRound,
  AlertCircle,
  AlertTriangle,
  Zap,
  ZapOff,
  Mail,
  Phone,
  Calendar,
  Filter,
  List,
  CalendarDays,
  Check,
  Printer,
  type LucideProps,
  type LucideIcon,
} from 'lucide-react-native';
import {COLORS} from '../constants/theme';

// AERIS line-icon component per Brand Guidelines v0.3 §08.
// Wraps lucide-react-native (the §08 baseline library) with the AERIS
// conventions baked in: 1.5–2 px stroke at 24 px default size, geometric
// not illustrative, single colour from the palette. Internal name map keeps
// the call-site API stable while we migrate off @expo/vector-icons — so a
// callsite is just `<Icon name="trash-outline" />` and the Lucide glyph is
// chosen here. Use the new lucide names (`name="trash"`, `name="x"`) in any
// fresh code; legacy ion-style names below remain for migration parity.

type IconName =
  // ------- lucide-native names (preferred for new code) -------
  | 'plus' | 'minus' | 'x' | 'x-circle'
  | 'search' | 'settings' | 'clock' | 'trash' | 'trending-up'
  | 'fingerprint' | 'cloud-off' | 'camera' | 'coffee' | 'box'
  | 'folder' | 'globe' | 'shopping-cart'
  | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'tag' | 'map-pin'
  | 'user' | 'users' | 'receipt' | 'bar-chart' | 'activity'
  | 'barcode' | 'key-round' | 'alert-circle' | 'alert-triangle'
  | 'zap' | 'zap-off' | 'mail' | 'phone' | 'calendar' | 'filter' | 'list'
  | 'check' | 'printer'
  // ------- legacy ion-style aliases (kept while we migrate) -------
  | 'add' | 'remove' | 'close' | 'close-circle'
  | 'search-outline' | 'settings-outline' | 'time-outline'
  | 'trash-outline' | 'cube' | 'cart' | 'cart-outline' | 'finger-print'
  | 'cloud-offline-outline' | 'camera-outline' | 'cafe-outline'
  | 'folder-outline' | 'pricetag-outline' | 'location-outline'
  | 'person' | 'person-outline' | 'people' | 'walk-outline' | 'stats-chart'
  | 'chevron-back' | 'chevron-forward' | 'barcode-outline'
  | 'keypad-outline' | 'warning-outline' | 'mail-outline' | 'call-outline'
  | 'flash' | 'flash-off'
  | 'people-outline' | 'cube-outline' | 'alert-circle-outline'
  | 'close-circle-outline' | 'receipt-outline' | 'today-outline'
  | 'calendar-outline' | 'list-outline';

const ICON_MAP: Record<IconName, LucideIcon> = {
  // lucide canonical names
  plus: Plus, minus: Minus, x: X, 'x-circle': XCircle,
  search: Search, settings: Settings, clock: Clock,
  trash: Trash2, 'trending-up': TrendingUp,
  fingerprint: Fingerprint, 'cloud-off': CloudOff,
  camera: Camera, coffee: Coffee, box: Box,
  folder: Folder, globe: Globe, 'shopping-cart': ShoppingCart,
  'chevron-left': ChevronLeft, 'chevron-right': ChevronRight, 'chevron-down': ChevronDown,
  tag: Tag, 'map-pin': MapPin,
  user: User, users: Users, receipt: Receipt,
  'bar-chart': BarChart3, activity: Activity,
  barcode: Barcode, 'key-round': KeyRound,
  'alert-circle': AlertCircle, 'alert-triangle': AlertTriangle,
  zap: Zap, 'zap-off': ZapOff, mail: Mail, phone: Phone,
  calendar: Calendar, filter: Filter, check: Check, printer: Printer,
  // ion-name aliases pointing at the same lucide components
  add: Plus, remove: Minus, close: X, 'close-circle': XCircle,
  'search-outline': Search, 'settings-outline': Settings,
  'time-outline': Clock, 'trash-outline': Trash2, cube: Box,
  cart: ShoppingCart, 'cart-outline': ShoppingCart, 'finger-print': Fingerprint,
  'cloud-offline-outline': CloudOff, 'camera-outline': Camera,
  'cafe-outline': Coffee, 'folder-outline': Folder,
  'pricetag-outline': Tag, 'location-outline': MapPin,
  person: User, 'person-outline': User, people: Users,
  'walk-outline': Activity, 'stats-chart': BarChart3,
  'chevron-back': ChevronLeft, 'chevron-forward': ChevronRight,
  'barcode-outline': Barcode, 'keypad-outline': KeyRound,
  'warning-outline': AlertTriangle,
  'mail-outline': Mail, 'call-outline': Phone,
  flash: Zap, 'flash-off': ZapOff,
  'people-outline': Users, 'cube-outline': Box,
  'alert-circle-outline': AlertCircle, 'close-circle-outline': XCircle,
  'receipt-outline': Receipt,
  'today-outline': Calendar, 'calendar-outline': CalendarDays,
  list: List, 'list-outline': List,
};

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}

const Icon: React.FC<IconProps> = ({
  name,
  size = 24,
  color = COLORS.navy,
  strokeWidth = 1.75,    // mid-point of §08's 1.5-2px range
  style,
}) => {
  const LucideComp = ICON_MAP[name];
  if (!LucideComp) return null;
  const props: LucideProps = {
    size,
    color,
    strokeWidth,
    style: style as LucideProps['style'],
  };
  return <LucideComp {...props} />;
};

export default Icon;
