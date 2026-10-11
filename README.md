# Supplier Desk (Ryans BD + StarTech BD)

A small website that runs on your own computer. Paste product links, see them as a
product list with your cost, your sell price and stock status, edit prices, and export.

## Start it (Windows)

1. Install Python once, if you do not have it: https://www.python.org/downloads/
   On the first screen of the installer, tick **Add python.exe to PATH**.
2. Right-click the zip and choose **Extract All**. Do not run it from inside the zip.
3. Double-click `start.bat`. If Windows says "Windows protected your PC", click **More info**, then **Run anyway**.
4. Your browser opens at http://127.0.0.1:5000. Keep the black window open while you use it. Close it to stop.

If a Windows Firewall box appears, you can click Cancel. The tool only talks to your own computer.

If `start.bat` does not work, open Command Prompt in this folder and run:

    py -3 -m pip install -r requirements.txt
    py -3 app.py

## Start it (Mac)

1. Unzip the folder.
2. Right-click `start.command` and choose Open (the first time only, because the file came from the internet).
3. Your browser opens at http://127.0.0.1:5000. Keep the Terminal window open while you use it. Close it to stop.

If that does not work, open Terminal in this folder and run:

    pip3 install -r requirements.txt
    python3 app.py

## Using it

- **Add products:** paste links, one per line, press Fetch. It waits a few seconds between links on purpose.
- **Recheck all:** fetches every saved product again and highlights price and stock changes.
- **Pricing settings:** markup %, fixed amount, rounding, and which supplier price counts as your cost.
  StarTech is set to regular price. Ryans is set to special price. Change either in the settings.
- **Sell price box:** type your own price to override the formula. It is kept when you recheck or change settings.
- **Export CSV:** opens in Excel or Google Sheets.
- **Send to Daraz:** switched off until Daraz approves your API access.

Your data is saved in the `data` folder next to the app. The page only listens on your own computer,
so nobody else on your network can open it.

## If a product shows "no specs parsed"

The first time you fetch a product from a new category, the spec table may not be read correctly.
Run once from Command Prompt (Windows: `py -3 scraper.py LINK --save-html`, Mac: `python3 scraper.py LINK --save-html`),
then send the file in the `debug` folder to Claude to fix it.

## Notes

- Check each supplier's terms before fetching at volume.
- Copy each product's warranty as the supplier states it into your Daraz listing.
