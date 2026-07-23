export type PresetId =
  | 'quiz_solver'
  | 'page_summary'
  | 'translate_visible'
  | 'explain_screenshot'
  | 'extract_information'
  | 'custom';
export const PRESETS: Record<
  PresetId,
  { label: string; description: string; instruction: string }
> = {
  quiz_solver: {
    label: 'حل سؤال',
    description: 'حل سؤال اصلی قابل مشاهده.',
    instruction:
      'حل سؤال اصلی قابل مشاهده شامل چندگزینه‌ای، درست/غلط و پاسخ کوتاه؛ متن گزینه درست و توضیح کوتاه را ارائه کن.',
  },
  page_summary: {
    label: 'خلاصه صفحه',
    description: 'خلاصه محتوای قابل مشاهده.',
    instruction: 'محتوای مهم قابل مشاهده صفحه را کوتاه و دقیق خلاصه کن.',
  },
  translate_visible: {
    label: 'ترجمه صفحه',
    description: 'ترجمه محتوای مهم صفحه.',
    instruction:
      'زبان را تشخیص بده و محتوای مهم قابل مشاهده را ترجمه کن؛ نام‌ها، اعداد، URLها و ساختار فهرست را حفظ کن. اگر متن فارسی است به انگلیسی و در غیر این صورت به فارسی ترجمه کن.',
  },
  explain_screenshot: {
    label: 'توضیح تصویر',
    description: 'توضیح روشن درباره تصویر.',
    instruction: 'محتوای تصویر صفحه را ساده، روشن و کوتاه توضیح بده.',
  },
  extract_information: {
    label: 'استخراج اطلاعات',
    description: 'استخراج نام‌ها، اعداد و نکات.',
    instruction:
      'مهم‌ترین نام‌ها، اعداد، تاریخ‌ها، قیمت‌ها، نشانی‌ها و شناسه‌های قابل مشاهده را دقیق استخراج کن.',
  },
  custom: { label: 'دلخواه', description: 'دستور دلخواه کاربر.', instruction: '' },
};
export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];
