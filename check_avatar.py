from playwright.sync_api import sync_playwright
import time
import sys

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Capture console errors
        errors = []
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        print("Navigating to http://127.0.0.1:3000...")
        page.goto('http://127.0.0.1:3000')
        page.wait_for_load_state('networkidle')
        
        # Take screenshot before click
        page.screenshot(path='/tmp/before_click.png')

        print("Looking for avatar to click...")
        # Find the trigger (usually a User icon inside a button or div)
        # It's a User icon inside a button/div inside the header
        trigger = page.locator("header").locator("button").filter(has=page.locator("svg.lucide-user"))
        if trigger.count() == 0:
            print("Could not find the avatar trigger by icon, trying by other means.")
            trigger = page.locator("header").locator("button.flex.items-center.rounded-full")
            if trigger.count() == 0:
                print("Could not find trigger at all.")
                print(page.content())
                browser.close()
                sys.exit(1)
        
        print("Clicking avatar...")
        trigger.first.click()
        time.sleep(1) # wait for menu to mount and crash
        
        page.screenshot(path='/tmp/after_click.png')
        
        print("Collected Errors:")
        for err in errors:
            print(f"ERROR: {err}")
            
        print("Checking if 'This page couldn't load' is visible...")
        if page.locator("text=This page couldn't load").is_visible():
            print("CRASH DETECTED!")
            
        browser.close()

if __name__ == "__main__":
    main()
