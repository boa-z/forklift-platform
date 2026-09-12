/*
 * d211-touch：D211 调试用 evdev protocol-B 触摸注入工具。
 *
 * 用法：
 *   d211-touch /dev/input/event0 tap <x> <y>
 *   d211-touch /dev/input/event0 multi <x1> <y1> [x2 y2 ...]
 *   d211-touch /dev/input/event0 hold <ms>
 *
 * 说明：只用于设备验收与调试；产品代码不依赖该工具。
 */

#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

/** 写一个 input_event；失败时报错退出。 */
static void emit(int fd, int type, int code, int value) {
  struct input_event event;
  memset(&event, 0, sizeof(event));
  event.type = type;
  event.code = code;
  event.value = value;
  if (write(fd, &event, sizeof(event)) != (ssize_t)sizeof(event)) {
    fprintf(stderr, "d211-touch: write 失败: %s\n", strerror(errno));
    exit(1);
  }
}

/** 同步一帧事件。 */
static void sync_frame(int fd) { emit(fd, EV_SYN, SYN_REPORT, 0); }

/** 毫秒级休眠。 */
static void sleep_ms(int ms) { usleep((useconds_t)ms * 1000); }

/** 按下给定触点列表（最多 10 点，protocol B slot 编号）。 */
static void touch_down(int fd, int count, int *xs, int *ys) {
  // 内核 input core 会做去抖：与 slot 内上一次相同的值会被直接丢弃。
  // 自动注入的坐标常常重复，这里加入 1-2px 的交替抖动（命中区域远大于 2px），
  // 并用 TOUCH_MAJOR 牺牲一次吸收 slot 切换时的 flush。
  static unsigned int tracking_seq = 0;
  tracking_seq += 1;
  if (tracking_seq > 0x7fff) tracking_seq = 1;
  unsigned int base_id = (unsigned int)time(0) % 100000 + tracking_seq;
  // 内核按 slot 记录上一次的值并去抖；应用重启后记录仍在，因此每次注入
  // 都要落在一个新坐标上。±4px 的分布覆盖连续点击且不影响命中判定。
  int step = (int)(base_id % 9);
  int jitter_x = step - 4;
  int jitter_y = ((int)(base_id / 9) % 9) - 4;
  for (int i = 0; i < count; i++) {
    unsigned int id = base_id + (unsigned int)i;
    if (id == 0) id = 1;
    emit(fd, EV_ABS, ABS_MT_SLOT, i);
    emit(fd, EV_ABS, ABS_MT_TOUCH_MAJOR, 100 + (int)(base_id % 155));
    emit(fd, EV_ABS, ABS_MT_POSITION_X, xs[i] + jitter_x + i);
    emit(fd, EV_ABS, ABS_MT_POSITION_Y, ys[i] + jitter_y - i);
    emit(fd, EV_ABS, ABS_MT_TRACKING_ID, (int)id);
    if (i == 0) emit(fd, EV_KEY, BTN_TOUCH, 1);
    sync_frame(fd);
    sleep_ms(20);
  }
  sleep_ms(40);
}

/** 抬起全部触点。 */
static void touch_up(int fd, int count) {
  for (int i = 0; i < count; i++) {
    emit(fd, EV_ABS, ABS_MT_SLOT, i);
    // 同样用牺牲事件吸收 slot flush，保证 tracking -1 送达。
    emit(fd, EV_ABS, ABS_MT_TOUCH_MAJOR, 101 + i);
    emit(fd, EV_ABS, ABS_MT_TRACKING_ID, -1);
    if (i == 0) emit(fd, EV_KEY, BTN_TOUCH, 0);
    sync_frame(fd);
    sleep_ms(10);
  }
  sync_frame(fd);
}

/** 监听事件 N 毫秒并打印（调试用）。 */
static void watch_events(const char *path, int ms) {
  int fd = open(path, O_RDONLY | O_NONBLOCK);
  if (fd < 0) {
    fprintf(stderr, "d211-touch: 打开 %s 失败: %s\n", path, strerror(errno));
    return;
  }
  long elapsed = 0;
  while (elapsed < ms) {
    struct input_event event;
    ssize_t bytes = read(fd, &event, sizeof(event));
    if (bytes == (ssize_t)sizeof(event)) {
      printf("type=%u code=%u value=%d\n", event.type, event.code, event.value);
      fflush(stdout);
    } else {
      usleep(2000);
      elapsed += 2;
    }
  }
  close(fd);
}

/** 打印设备的 ABS 能力位（调试用）。 */
static void print_caps(const char *path) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) {
    fprintf(stderr, "d211-touch: 打开 %s 失败: %s\n", path, strerror(errno));
    return;
  }
  unsigned long bits[(ABS_MAX + 1 + 8 * sizeof(unsigned long) - 1) /
                     (8 * sizeof(unsigned long))];
  memset(bits, 0, sizeof(bits));
  if (ioctl(fd, EVIOCGBIT(EV_ABS, sizeof(bits)), bits) < 0) {
    fprintf(stderr, "d211-touch: EVIOCGBIT 失败: %s\n", strerror(errno));
    close(fd);
    return;
  }
  for (int code = 0; code <= ABS_MAX; code++) {
    unsigned long word = bits[code / (int)(8 * sizeof(unsigned long))];
    int bit = code % (int)(8 * sizeof(unsigned long));
    if ((word >> bit) & 1UL) printf("abs %d set\n", code);
  }
  close(fd);
}

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "用法: d211-touch <event> tap <x> <y> | multi <x1> <y1> ... | hold <ms>\n");
    return 2;
  }
  const char *path = argv[1];
  const char *mode = argv[2];
  if (strcmp(mode, "watch") == 0) {
    watch_events(path, argc >= 4 ? atoi(argv[3]) : 1000);
    return 0;
  }
  if (strcmp(mode, "caps") == 0) {
    print_caps(path);
    return 0;
  }
  int fd = open(path, O_WRONLY);
  if (fd < 0) {
    fprintf(stderr, "d211-touch: 打开 %s 失败: %s\n", path, strerror(errno));
    return 1;
  }
  if (strcmp(mode, "tap") == 0) {
    if (argc != 5) {
      fprintf(stderr, "d211-touch: tap 需要 x y\n");
      return 2;
    }
    int xs[1] = {atoi(argv[3])};
    int ys[1] = {atoi(argv[4])};
    touch_down(fd, 1, xs, ys);
    touch_up(fd, 1);
  } else if (strcmp(mode, "multi") == 0) {
    int count = (argc - 3) / 2;
    if (count < 1 || count > 10 || (argc - 3) % 2 != 0) {
      fprintf(stderr, "d211-touch: multi 需要成对的 x y（1-10 点）\n");
      return 2;
    }
    int xs[10];
    int ys[10];
    for (int i = 0; i < count; i++) {
      xs[i] = atoi(argv[3 + i * 2]);
      ys[i] = atoi(argv[4 + i * 2]);
    }
    touch_down(fd, count, xs, ys);
    touch_up(fd, count);
  } else if (strcmp(mode, "abs") == 0) {
    if (argc != 5) {
      fprintf(stderr, "d211-touch: abs 需要 <code> <value>\n");
      return 2;
    }
    emit(fd, EV_ABS, atoi(argv[3]), atoi(argv[4]));
    sync_frame(fd);
  } else if (strcmp(mode, "hold") == 0) {
    if (argc != 4) {
      fprintf(stderr, "d211-touch: hold 需要毫秒数\n");
      return 2;
    }
    sleep_ms(atoi(argv[3]));
  } else {
    fprintf(stderr, "d211-touch: 未知模式 %s\n", mode);
    return 2;
  }
  close(fd);
  return 0;
}
