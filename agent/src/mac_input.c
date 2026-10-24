#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

static CGPoint currentPos = {0, 0};
static bool leftDown = false;
static bool rightDown = false;

static void print_screen_size(void) {
    CGDirectDisplayID display = CGMainDisplayID();
    size_t w = CGDisplayPixelsWide(display);
    size_t h = CGDisplayPixelsHigh(display);
    printf("SCREEN %zu %zu\n", w, h);
    fflush(stdout);
}

static void post_mouse_move(double x, double y) {
    currentPos.x = x;
    currentPos.y = y;
    CGEventType type = kCGEventMouseMoved;
    CGMouseButton button = kCGMouseButtonLeft;
    if (leftDown) {
        type = kCGEventLeftMouseDragged;
        button = kCGMouseButtonLeft;
    } else if (rightDown) {
        type = kCGEventRightMouseDragged;
        button = kCGMouseButtonRight;
    }
    CGEventRef ev = CGEventCreateMouseEvent(NULL, type, currentPos, button);
    if (ev) {
        CGEventPost(kCGHIDEventTap, ev);
        CFRelease(ev);
    }
}

static void post_mouse_button(int buttonNum, bool down) {
    CGEventType type;
    CGMouseButton btn;
    if (buttonNum == 2) {
        btn = kCGMouseButtonRight;
        type = down ? kCGEventRightMouseDown : kCGEventRightMouseUp;
        rightDown = down;
    } else {
        btn = kCGMouseButtonLeft;
        type = down ? kCGEventLeftMouseDown : kCGEventLeftMouseUp;
        leftDown = down;
    }
    CGEventRef ev = CGEventCreateMouseEvent(NULL, type, currentPos, btn);
    if (ev) {
        CGEventPost(kCGHIDEventTap, ev);
        CFRelease(ev);
    }
}

static void post_scroll(int dy, int dx) {
    CGEventRef ev = CGEventCreateScrollWheelEvent2(NULL, kCGScrollEventUnitPixel, 2, dy, dx, 0);
    if (ev) {
        CGEventPost(kCGHIDEventTap, ev);
        CFRelease(ev);
    }
}

static void post_key(CGKeyCode keyCode, bool down) {
    CGEventRef ev = CGEventCreateKeyboardEvent(NULL, keyCode, down);
    if (ev) {
        CGEventPost(kCGHIDEventTap, ev);
        CFRelease(ev);
    }
}

static void type_unicode(const char *text) {
    size_t len = strlen(text);
    if (len == 0) return;
    UniChar *buf = (UniChar *)malloc(sizeof(UniChar) * len);
    if (!buf) return;
    for (size_t i = 0; i < len; i++) {
        buf[i] = (UniChar)(unsigned char)text[i];
    }
    CGEventRef evDown = CGEventCreateKeyboardEvent(NULL, 0, true);
    CGEventRef evUp = CGEventCreateKeyboardEvent(NULL, 0, false);
    if (evDown && evUp) {
        CGEventKeyboardSetUnicodeString(evDown, len, buf);
        CGEventKeyboardSetUnicodeString(evUp, len, buf);
        CGEventPost(kCGHIDEventTap, evDown);
        CGEventPost(kCGHIDEventTap, evUp);
    }
    if (evDown) CFRelease(evDown);
    if (evUp) CFRelease(evUp);
    free(buf);
}

int main(void) {
    setvbuf(stdin, NULL, _IOLBF, 0);
    setvbuf(stdout, NULL, _IOLBF, 0);

    print_screen_size();

    char line[1024];
    while (fgets(line, sizeof(line), stdin)) {
        size_t len = strlen(line);
        while (len > 0 && (line[len - 1] == '\r' || line[len - 1] == '\n')) {
            line[--len] = '\0';
        }
        if (len == 0) continue;

        char cmd = line[0];
        if (cmd == 'q') {
            break;
        } else if (cmd == 's') {
            print_screen_size();
        } else if (cmd == 'm') {
            double x = 0, y = 0;
            if (sscanf(line + 1, "%lf %lf", &x, &y) == 2) {
                post_mouse_move(x, y);
            }
        } else if (cmd == 'd') {
            int btn = 0;
            if (sscanf(line + 1, "%d", &btn) >= 1) {
                post_mouse_button(btn, true);
            }
        } else if (cmd == 'u') {
            int btn = 0;
            if (sscanf(line + 1, "%d", &btn) >= 1) {
                post_mouse_button(btn, false);
            }
        } else if (cmd == 'w') {
            int dy = 0, dx = 0;
            if (sscanf(line + 1, "%d %d", &dy, &dx) >= 1) {
                post_scroll(dy, dx);
            }
        } else if (cmd == 'k') {
            int code = 0, down = 0;
            if (sscanf(line + 1, "%d %d", &code, &down) == 2) {
                post_key((CGKeyCode)code, down != 0);
            }
        } else if (cmd == 't') {
            char *text = line + 1;
            while (*text == ' ') text++;
            type_unicode(text);
        }
    }
    return 0;
}
