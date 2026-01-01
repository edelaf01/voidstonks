# voidstonks

VoidStonks 🌌
VoidStonks is a comprehensive Warframe companion tool designed to streamline the Looking For Group (LFG) process and optimize your relic farming efficiency.

Originally conceived as a simple recruitment text generator, the project evolved into a multi-featured utility suite. It bridges the gap for players on platforms without easy access to overlay tools (Consoles, Linux, Mobile) by offering OCR inventory scanning, market pricing analysis, and cross-device clipboard synchronization.

✨ Key Features
Relic Profit Analyzer: Calculate average Platinum prices per relic based on refinement levels and squad size.

OCR Inventory System: Scan your inventory using your camera or image files (powered by Tesseract). No direct Warframe account access required.

Smart LFG Generator: Create consistent recruit messages and save presets for different mission types (Eidolon, Archimedea, etc.).

Fissure Optimizer: Automatically highlights active "fast" fissures (Steel Path/Omnia) matching your selected relic era.

Cross-Device Sync: Send generated LFG messages from your phone to your PC/Console via a lightweight cloud sync feature.

🛠️ Functionality Breakdown

1. Relic Analyzer & Market Data (Tab 1 & 2)
   This is the core utility for maximizing profit.

Price Calculation: Look up any relic to see average Platinum prices per refinement (Intact vs. Radiant) and group size (1-4 players).

Drop Tables: View contents, rarity, prices, and direct links to Warframe Market.

Set Completion: Track your progress on Prime Sets. Select a missing part to instantly see which relics drop it.

Navigation: Seamlessly jump between inspecting a specific Part (Tab 2) and its dropping Relics (Tab 1).

2. Inventory Management & OCR
   Designed for players who cannot inject code into the game (Console/Linux/Phone users).

Non-Intrusive: The app does not access your Warframe account data.

Photo Scan: Use your device's camera or upload a screenshot to scan your relic inventory.

Local Inventory: Tracks your scanned relics, allowing you to sort by "Most Profitable" (Radiant/Intact) or average Ducat value (WIP).

3. Smart LFG & Recruiting (Tab 5)
   The original purpose of the app: making recruiting less tedious.

Message Generator: Auto-generate formatted recruit messages (e.g., H [Lith G1 Relic] Rad 2/4).

Presets: Save templates for complex runs like Eidolon Hunts (Roles: VS, Lures) or Deep Archimedea (Elite/Normal).

Cloud Sync: Generate a message on your phone and "teleport" it to your PC via a 4-digit code system (Limited to 1000 daily writes globally).

Planned: Message variation to bypass chat spam filters.

4. Fissure Tracker
   "Fast" Fissures: Filters the active fissure list to show recommended fast mission types (Capture, Exterminate, etc.).

Auto-Highlight: Selecting an Axi relic in Tab 1 will automatically highlight available Axi fissures in this tab.

Omnia & Steel Path: Full support for advanced mission types.

5. Riven & Profile Tools (Tab 3 & 4)
   Riven Prices: Fetches average asking prices for Rivens based on online-in-game status.

Profile Calculator: (WIP) A simple calculator for Daily Standing and Focus caps based on Mastery Rank. Note: Automatic profile fetching is currently disabled due to API limitations.

🔒 Privacy & Data Storage
Local Storage: Your inventory, presets, and checklists are stored locally in your browser.

No Account Access: This tool does not require your Warframe login credentials.

Cloud Sync: The sync feature uses a temporary key-value database solely for transferring text strings between your devices.

⚠️ API Usage Disclaimer
This project relies on the Warframe Market API.

I have optimized the tool to respect API rate limits.

Data is cached (1-hour max age per item) and routed through a rate-limited worker to prevent overloading the providers.

Headers are embedded identifying the app as VoidStonks.

🚀 Roadmap
Development is done in my free time alongside work and studies. Updates happen "often-ish."

Planned: Fine-tuning Ducat calculations.

Planned: Expanded Riven grading tools.

Planned: More mission types for the Fissure Tracker.

Planned: Anti-spam text variation for LFG messages.

🤝 Contributing & Feedback
Questions, suggestions, and bug reports are always welcome! Please understand that development pace may vary.

This is a fan-made tool and is not affiliated with Digital Extremes.
