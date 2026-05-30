# Correctly Extension - DESIGN.md

## Color Palette

### Primary
- **Green**: `#2d7d46` (used for primary buttons, active toggles, accent elements)
- **Green Dark**: `#236b38` (hover state for primary buttons)
- **Green Darker**: `#1a5a2d` (active/pressed state for primary buttons)

### Neutrals
- **Background**: `#fafafa` (main popup background)
- **Text Primary**: `#1a1a1a` (main text, labels)
- **Text Secondary**: `#555` (subtext, hints, disabled elements)
- **Text Tertiary**: `#888` (subtle text, placeholders)
- **Text Quaternary**: `#999` (helper text, small labels)
- **Border**: `#ddd` (default input/border color)
- **Border Focus**: `#2d7d46` (focused input border)
- **Card Background**: `#fff` (input backgrounds, card-like elements)
- **Divider**: `#eee` (section dividers)
- **Success Background**: `#e8f5e9` (success status background)
- **Error Background**: `#ffebee` (error status background)
- **Success Text**: `#2d7d46` (success status text)
- **Error Text**: `#c62828` (error status text)
- **Info Background**: `#f0f4f8` (AI status section background)
- **Info Border**: `#d0dbe8` (AI status section border)
- **Usage Background**: `#f5f9f6` (usage stats background)
- **Usage Border**: `#d4edda` (usage stats border)
- **Usage Last Border**: `#e0ece3` (usage last updated divider)

### Interactive States
- **Input Focus**: Border color changes to primary green (`#2d7d46`)
- **Button Hover**: Primary button darkens slightly (`#236b38`)
- **Button Active**: Primary button darker (`#1a5a2d`)
- **Toggle Slider**: Changes from `#ccc` to primary green (`#2d7d46`) when checked
- **Tooltip Visibility Button**: Opacity changes from 0.5 to 1.0 on hover
- **Model Ready Pulse**: Model select briefly pulses green when models are loaded

## Typography

### Font Family
- **System**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

### Font Sizes
- **Heading (h1)**: `20px`
- **Subtitle**: `12px`
- **Labels**: `12px`
- **Inputs/Selects**: `14px`
- **Buttons**: `14px`
- **Hints/Helper Text**: `11px`
- **Toggle Label**: `14px`
- **Site Host**: `11px`
- **Usage Value**: `18px`
- **Usage Label**: `11px`
- **Usage Detail**: `12px`
- **Usage Last**: `11px`
- **Log Select**: `13px`

### Font Weights
- **Heading**: `700` (bold)
- **Labels**: `600` (semi-bold)
- **Buttons**: `600` (semi-bold)
- **Toggle Label**: `500` (medium)
- **Usage Value**: `700` (bold)
- **Secondary Buttons**: `600` (semi-bold)

### Letter Spacing
- **Heading**: `-0.3px`
- **Labels**: `0.5px` (uppercase)
- **Usage Label**: `0.3px` (uppercase)

### Line Heights
- Generally uses default line heights with specific overrides:
- **Usage Value**: `1` (tight)
- Most elements use browser defaults

## Spacing & Layout

### Container
- **Popup Width**: `320px`
- **Container Padding**: `20px` all sides

### Section Margins
- **Most Sections**: `16px` bottom margin
- **Header**: `20px` bottom margin
- **Actions**: `12px` bottom margin
- **Status Message**: `12px` bottom margin
- **Toggle Section**: `12px` top padding, `1px solid #eee` top border
- **Site Section**: `12px` top padding, `1px solid #eee` top border
- **Usage Section**: `12px` top padding, `1px solid #eee` top border
- **Log Section**: `12px` top margin, `12px` top padding, `1px solid #eee` top border

### Element Dimensions
- **Input Height**: `42px` (10px padding + 14px font + 2x border)
- **Button Height**: `40px` (10px padding + 14px font)
- **Secondary Button Height**: `36px` (10px padding + 13px font)
- **Toggle Slider**: `40px width × 22px height`
- **Toggle Slider Circle**: `18px × 18px`
- **Eye Icon**: `16px` font size

### Border Radii
- **Inputs/Buttons**: `8px`
- **Status Message**: `6px`
- **Toggle Slider**: `11px`
- **Toggle Slider Circle**: `50%` (circle)
- **Cards (Usage Stats)**: `8px`

### Shadows & Effects
- **Transitions**: 
  - Input/Border: `0.2s`
  - Button Background: `0.2s`
  - Toggle Slider: `0.2s`
  - Toggle Slider Circle: `0.2s`
  - Eye Icon Opacity: `0.2s`

## Component Specifications

### Provider Section
- Label: Uppercase, 12px, 600 weight, 0.5px letter spacing, #555 color
- Select: Full width, 14px font, 10px padding, 1.5px #ddd border, 8px radius

### Model Section
- Label: Same as above
- Select: Same as above
- Custom Model Input: Same as above, hidden by default, 8px top margin
- Model Hint: 11px font, #999 color, 4px top margin, min-height 14px

### Base URL Section
- Label: Same as above
- Wrapper: Full-width single input row
- Input: Full width, placeholder text, 10px padding
- Model Loading: Triggered automatically after valid URL + API key with debounce
- Hint: 11px font, #737373 color, 4px top margin, min-height 14px (loading/ready/error states)
- Datalist: For suggestions

### AI Status Section
- Container: 10px vertical padding, 12px horizontal padding, #f0f4f8 background, #d0dbe8 border, 8px radius
- Content Area: Dynamic content insertion

### Key Section
- Label: Same as above
- Wrapper: Relative positioning
- Input: Password type, 40px right padding for visibility toggle
- Visibility Button: Absolute positioning, 8px from right, 50% top translated, 4px padding, 16px font, #128065 (eye) unicode, 0.5 opacity, 0.2s transition
- Hover State: Opacity 1.0

### Actions Section
- Save Button: Full width, 10px padding, #2d7d46 background, #fff color, 14px font, 600 weight, 8px radius, 0.2s background transition
- Hover State: #236b38 background
- Active State: #1a5a2d background

### Status Message
- Centered text, 13px font, 8px padding, 6px radius
- Success: #e8f5e9 background, #2d7d46 color
- Error: #ffebee background, #c62828 color
- Warning: #fff8e1 background, #e65100 color

### Toggle Section
- Container: 12px top padding, 1px solid #eee top border
- Label: Flex display, space-between alignment, center vertical alignment, pointer cursor, none text transform, 14px font, 500 weight, #1a1a1a color
- Checkbox: Hidden visually
- Slider: 40px width, 22px height, #ccc background, 11px radius, 0.2s background transition
- Slider Circle: 18px width/height, #fff background, 50% radius (circle), 2px top/left positioning, 0.2s transform transition
- Checked State: Slider background #2d7d46, circle transformed to translateX(18px)

### Site Section
- Same structure as toggle section
- Label Text: "Active on this site"
- Host Text: 11px font, #999 color, 4px top margin

### Usage Section
- Container: 12px top padding, 1px solid #eee top border
- Label: Same as section labels
- Stats Container: #f5f9f6 background, #d4edda border, 8px radius, 10px vertical padding, 12px horizontal padding
- Stat Row: Flex display, 16px gap
- Stat Item: Flex display, baseline alignment, 4px gap
- Stat Value: 18px font, 700 weight, #2d7d46 color, line-height 1
- Stat Label: 11px font, 777 color, uppercase, 0.3px letter spacing
- Stat Detail: 12px font, #777 color, 4px top margin
- Last Updated: 11px font, #999 color, 4px top margin, 4px top padding, 1px solid #e0ece3 top border

### Log Section
- Container: 12px top margin, 12px top padding, 1px solid #eee top border
- Label: Same as section labels
- Select: 13px font, 8px vertical padding, 10px horizontal padding, #555 color

## Motion & Animation

### Transitions
- All interactive elements use 0.2s transitions for smooth state changes
- Input borders: border-color transition
- Buttons: background-color transition
- Toggles: background-color and transform transitions
- Eye icon: opacity transition

### Specific Animations
- **Model Select Loaded Pulse**:
  - Keyframe animation named `model-select-loaded`
  - Duration: ~1.6s, easing: `var(--ease-out-expo)`
  - Brief green border/glow/background pulse, then returns to default
- **Status Message Entry/Exit**:
  - View Transition API animations for status replacement (`status-enter`, `status-exit`)
  - Fade/scale enter and leave transitions
- **Compatibility Panel Entry**:
  - Panel reveal animation (`model-quality-in`)
  - Meter transitions update with View Transition API (`model-quality-meter`)

## Responsive Design
- Fixed width of 320px designed for Chrome extension popup
- Uses relative units where appropriate (flex, percentages)
- Text wrapping and overflow handled through container constraints
- No media queries as popup width is fixed by Chrome extension specifications

## Accessibility Considerations
- Proper label associations with form elements
- Sufficient color contrast (verified against WCAG guidelines)
- Keyboard navigable controls
- Visible focus states
- Touch-friendly minimum target sizes (44x44px minimum)
- ARIA attributes for dynamic content (implied through JS implementation)
- Respects system preferences where applicable (though uses system font stack)

## Design Language Summary
The Correctly extension employs a clean, minimalist design system with:
- A primary green color scheme (#2d7d46) for interactivity and accentuation
- Light, neutral backgrounds with subtle elevation through borders and shadows
- Rounded corners (8px radius) for a modern, approachable feel
- Clear typographic hierarchy using system fonts for familiarity
- Generous touch targets and spacing for ease of use
- Subtle animations and transitions for polished interactions
- Consistent spacing and alignment for visual harmony
- Error and success states using intuitive color coding (green/red)
- Model compatibility messaging written in plain language tiers: Not ready, Basic, Good, Great, Excellent
