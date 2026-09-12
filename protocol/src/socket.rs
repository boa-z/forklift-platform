//! AF_UNIX SOCK_SEQPACKET syscall wrappers. This module is the only place in
//! the protocol crate that talks to libc; everything above it is safe code.

use std::ffi::OsStr;
use std::io;
use std::mem;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::time::Duration;

const MAX_SUN_PATH: usize = 107;

fn sockaddr(path: &Path) -> io::Result<(libc::sockaddr_un, libc::socklen_t)> {
    let bytes = path.as_os_str().as_bytes();
    if bytes.len() > MAX_SUN_PATH {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("socket path is {} bytes (max {MAX_SUN_PATH})", bytes.len()),
        ));
    }
    // SAFETY: sockaddr_un is a plain C struct; zero is a valid start.
    let mut addr: libc::sockaddr_un = unsafe { mem::zeroed() };
    addr.sun_family = libc::AF_UNIX as libc::sa_family_t;
    for (slot, byte) in addr.sun_path.iter_mut().zip(bytes.iter()) {
        *slot = *byte as libc::c_char;
    }
    let length = mem::size_of::<libc::sa_family_t>() + bytes.len() + 1;
    Ok((addr, length as libc::socklen_t))
}

fn seqpacket() -> io::Result<OwnedFd> {
    // SAFETY: plain socket syscall; the returned fd is owned immediately.
    let fd = unsafe { libc::socket(libc::AF_UNIX, libc::SOCK_SEQPACKET, 0) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: fd is valid and not owned elsewhere.
    let owned = unsafe { OwnedFd::from_raw_fd(fd) };
    // Set CLOEXEC portably (SOCK_CLOEXEC is not exposed by libc on macOS).
    // SAFETY: fcntl on an owned, valid fd.
    if unsafe { libc::fcntl(owned.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(owned)
}

/// Connects to a listening daemon at `path`.
pub fn connect(path: &Path) -> io::Result<OwnedFd> {
    let fd = seqpacket()?;
    let (addr, length) = sockaddr(path)?;
    // SAFETY: addr and fd are valid for the duration of the call.
    let result = unsafe {
        libc::connect(
            fd.as_raw_fd(),
            &addr as *const libc::sockaddr_un as *const libc::sockaddr,
            length,
        )
    };
    if result < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(fd)
}

/// Creates a listening socket. The caller owns removing the socket file.
pub fn listen(path: &Path) -> io::Result<OwnedFd> {
    let fd = seqpacket()?;
    let (addr, length) = sockaddr(path)?;
    // SAFETY: addr and fd are valid for the duration of the call.
    let result = unsafe {
        libc::bind(
            fd.as_raw_fd(),
            &addr as *const libc::sockaddr_un as *const libc::sockaddr,
            length,
        )
    };
    if result < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: listening socket, backlog is a plain integer.
    if unsafe { libc::listen(fd.as_raw_fd(), 8) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(fd)
}

pub fn accept(fd: &OwnedFd) -> io::Result<OwnedFd> {
    // SAFETY: a zeroed sockaddr is acceptable for accept(2).
    let accepted = unsafe { libc::accept(fd.as_raw_fd(), std::ptr::null_mut(), std::ptr::null_mut()) };
    if accepted < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: accepted fd is owned immediately.
    Ok(unsafe { OwnedFd::from_raw_fd(accepted) })
}

/// Sends one datagram; SOCK_SEQPACKET preserves the message boundary.
pub fn send(fd: &OwnedFd, bytes: &[u8]) -> io::Result<()> {
    // SAFETY: buffer pointer/len are valid; MSG_NOSIGNAL keeps a dead peer
    // from killing the process.
    let written = unsafe {
        libc::send(
            fd.as_raw_fd(),
            bytes.as_ptr() as *const libc::c_void,
            bytes.len(),
            libc::MSG_NOSIGNAL,
        )
    };
    if written < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// Receives one datagram. `Ok(0)` means the peer disconnected; a datagram
/// larger than `buf` is truncated and must be rejected by the frame parser.
pub fn recv(fd: &OwnedFd, buf: &mut [u8]) -> io::Result<usize> {
    // SAFETY: buffer pointer/len are valid.
    let read = unsafe {
        libc::recv(
            fd.as_raw_fd(),
            buf.as_mut_ptr() as *mut libc::c_void,
            buf.len(),
            0,
        )
    };
    if read < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(read as usize)
}

pub fn poll_readable(fd: &OwnedFd, timeout: Option<Duration>) -> io::Result<bool> {
    let mut descriptor = libc::pollfd {
        fd: fd.as_raw_fd(),
        events: libc::POLLIN,
        revents: 0,
    };
    let timeout_ms = match timeout {
        Some(duration) => duration.as_millis().min(i32::MAX as u128) as libc::c_int,
        None => -1,
    };
    // SAFETY: one valid pollfd.
    let ready = unsafe { libc::poll(&mut descriptor, 1, timeout_ms) };
    if ready < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(ready > 0)
}

pub fn path_from_os(value: &OsStr) -> &Path {
    Path::new(value)
}
