/*
 * atsend - 向串口发送一条 AT 命令并打印应答（D211 验证用）。
 * 用法: atsend <ttydev> <command>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <termios.h>
#include <sys/select.h>

int main(int argc, char **argv)
{
	if (argc < 3) {
		fprintf(stderr, "usage: %s <ttydev> <command>\n", argv[0]);
		return 2;
	}
	int fd = open(argv[1], O_RDWR | O_NOCTTY | O_NONBLOCK);
	if (fd < 0) {
		perror("open");
		return 1;
	}
	struct termios t;
	memset(&t, 0, sizeof(t));
	cfmakeraw(&t);
	t.c_cflag |= CLOCAL | CREAD | CS8;
	cfsetispeed(&t, B115200);
	cfsetospeed(&t, B115200);
	tcsetattr(fd, TCSANOW, &t);
	tcflush(fd, TCIOFLUSH);

	char buf[256];
	snprintf(buf, sizeof(buf), "%s\r\n", argv[2]);
	if (write(fd, buf, strlen(buf)) < 0) {
		perror("write");
		return 1;
	}
	int total = 0;
	for (int loops = 0; loops < 15; loops++) {
		fd_set r;
		struct timeval tv;
		FD_ZERO(&r);
		FD_SET(fd, &r);
		tv.tv_sec = 0;
		tv.tv_usec = 200000;
		if (select(fd + 1, &r, 0, 0, &tv) > 0) {
			char out[512];
			int k = read(fd, out, sizeof(out));
			if (k > 0) {
				write(1, out, (size_t)k);
				total += k;
			}
		}
		if (total > 0 && loops > 4)
			break;
	}
	return total > 0 ? 0 : 1;
}
