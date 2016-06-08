'use strict';

function listLogins() {
  var users = [];
  for (var k in JSON.parse(localStorage.getItem('airbitz.users'))) {
    users.push(k);
  }
  return users;
}

var MenuItem = React.createClass({
  render: function() {
    return (
      <li>
        <a {...this.props} href="javascript:;" />
      </li>
    );
  }
});

var Button = React.createClass({
  render: function() {
    return (
      <a {...this.props}
        href="javascript:;"
        role="button"
        className={(this.props.className || '') + ' btn'} />
    );
  }
});

var BootstrapModal = React.createClass({
  componentDidMount: function() {
    $(this.refs.root).modal({backdrop: 'static', keyboard: false, show: false});
    $(this.refs.root).on('hidden.bs.modal', this.handleHidden);
  },
  componentWillUnmount: function() {
    $(this.refs.root).off('hidden.bs.modal', this.handleHidden);
  },
  close: function() {
    $(this.refs.root).modal('hide');
  },
  open: function() {
    $(this.refs.root).modal('show');
  },
  render: function() {
    return (
      <div className="modal fade" ref="root">
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <button
                type="button"
                className="close"
                onClick={this.handleCancel}>
                &times;
              </button>
              <h4>{this.props.title}</h4>
            </div>
            <div className="modal-body">
              {this.props.children}
            </div>
          </div>
        </div>
      </div>
    );
  },
  handleCancel: function() {
    if (this.props.onCancel) {
      this.props.onCancel();
    }
  },
  handleHidden: function() {
    if (this.props.onHidden) {
      this.props.onHidden();
    }
  }
});

var LoginForm = React.createClass({
  close: function() {
    this.refs.modal.close();
  },
  open: function(username) {
    this.refs.username.value = username;
    this.refs.password.value = '';
    this.refs.modal.open();
  },
  render: function() {
    return (
      <BootstrapModal
        ref="modal"
        cancel="Cancel"
        onCancel={this.props.onCancel}
        onHidden={this.props.onHidden}
        title="Sign In">
        <form>
          <div className="row">
            <div className="col-sm-12">
              <div className="form-group">
                <input ref="username" type="text" name="handle" placeholder="username" className="form-control" />
              </div>
            </div>
            <div className="col-sm-12">
              <div className="form-group">
                <div className="input-group">
                  <input ref="password" type="password" name="password" placeholder="password" className="form-control" />
                  <span className="input-group-btn">
                    <button type="button" onClick={this.handleSubmit}  className="btn btn-primary">Sign In</button>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </form>
      </BootstrapModal>
    );
  },
  handleSubmit: function() {
    var that = this;
    this.props.context.passwordLogin(this.refs.username.value, this.refs.password.value, function(err, result) {
        if (err) {
          alert("login Failed: " + err);
        } else {
          console.log(result);
          that.props.parentState.setState({isLoggedIn:true, account: result});
          that.close();
        }
    });
    return false;
  }
});

var PinLoginForm = React.createClass({
  getInitialState: function() {
    return { username: null };
  },
  close: function() {
    this.refs.modal.close();
  },
  open: function(username) {
    this.setState({username: username});
    this.refs.pin.value = null;
    this.refs.modal.open();
  },
  render: function() {
    return (
      <BootstrapModal
        ref="modal"
        cancel="Cancel"
        onCancel={this.props.onCancel}
        onHidden={this.props.onHidden}
        title="Pin Sign In">
          <form onSubmit={this.handleSubmit}>
            <div className="row">
              <div className="col-sm-12">
                <div className="form-group">
                  <span className="form-control">{this.state.username}</span>
                </div>
              </div>
              <div className="col-sm-12">
                <div className="form-group">
                  <div className="input-group">
                    <input ref="pin" type="password" name="password" placeholder="PIN" className="form-control" />
                  </div>
                </div>
              </div>
              <div className="col-sm-12">
                <div className="form-group">
                  <div className="input-group">
                    <span className="input-group-btn">
                      <button type="button" onClick={this.handleSubmit} className="btn btn-primary">Sign In</button>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </form>
      </BootstrapModal>
    );
  },
  handleSubmit: function() {
    var that = this;
    this.props.context.pinLogin(this.state.username, this.refs.pin.value, function(err, result) {
        if (err) {
            alert("pin login Failed: " + err);
        } else {
            console.log(result);
            that.props.parentState.setState({account: result});
            that.close();
        }
    });
    return false;
  }
});

var RegistrationForm = React.createClass({
  close: function() {
    this.refs.modal.close();
  },
  open: function() {
    this.refs.modal.open();
  },
  render: function() {
    return (
      <BootstrapModal
        ref="modal"
        onCancel={this.props.onCancel}
        onHidden={this.props.onHidden}
        cancel="Cancel"
        title="Register">
          <form>
            <div className="row">
              <div className="col-sm-12">
                <div className="form-group">
                  <input type="text" ref="username" placeholder="username" className="form-control" />
                </div>
              </div>
              <div className="col-sm-12">
                <div className="form-group">
                  <div className="input-group">
                    <input type="password" ref="password" placeholder="password" className="form-control" />
                  </div>
                </div>
              </div>
              <div className="col-sm-12">
                <div className="form-group">
                  <div className="input-group">
                    <input type="password" ref="pin" placeholder="pin" className="form-control" />
                  </div>
                </div>
              </div>
              <div className="col-sm-12">
                <div className="form-group">
                  <span className="input-group-btn">
                    <button type="button" onClick={this.handleSubmit} className="btn btn-primary">Register</button>
                  </span>
                </div>
              </div>
            </div>
          </form>
      </BootstrapModal>
    );
  },
  handleSubmit: function() {
    var that = this;
    this.props.context.accountCreate(this.refs.username.value, this.refs.password.value, function(err, result) {
        if (err) {
            alert("Registration Failed: " + err);
        } else {
            console.log(result);
            var account = result;
            that.props.parentState.setState({account: account});
            that.close();

            account.pinSetup(that.refs.pin.value, function(err, result) {});
        }
    });
    return false;
  }
});

var AccountView = React.createClass({
    render: function() {
        var body = null;
        if (this.props.account) {
            body = (
            <div className="row">
              <div className="col-sm-offset-3 col-sm-6">
                <div className="panel panel-default">
                  <div className="panel-heading">Account Information</div>
                  <div className="panel-body">
                    <table className="table">
                      <tbody>
                        <tr>
                          <th>Username: </th>
                          <td>{ this.props.account.username }</td>
                        </tr>
                        <tr>
                          <th>Auth Id: </th>
                          <td>{ this.props.account.authId }</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            );
        } else if (this.props.context) { 
            body = (
                <h3 className="text-center">You <strong>not</strong> are logged in!</h3>
            );
        } else {
            body = (
                <div className="row-fluid">
                    <div className="col-sm-offset-3 col-sm-6">
                        <h3 className="text-center">Please enter your developer API key to begin!</h3>
                        <p>
                        If you need an API key, please go to <a href="https://developer.airbitz.co">developer.airbitz.co</a>, 
                        signup and get your API key.
                        </p>
                    </div>
                </div>
            );
        }
        return (body);
    }
});

var AbcApp = React.createClass({
  getInitialState: function() {
    return { account: null };
  },
  render: function() {
    var keyBlock = null, loginBlock = null, registrationBlock = null, logoutBlock = null;
    if (this.state.context) {
      if (this.state.account) {
          logoutBlock = (<MenuItem onClick={this.handleLogout}>Logout</MenuItem>);
      } else {
          registrationBlock = (<MenuItem onClick={this.openSignupModal}>Register</MenuItem>);
          var logins = listLogins();
          var that = this;
          if (logins.length) {
            loginBlock = (
              <li className="dropdown">
                <a href="#" className="dropdown-toggle" data-toggle="dropdown" role="button" aria-haspopup="true" aria-expanded="false">Login <span className="caret"></span></a>
                <ul className="dropdown-menu">
                  <MenuItem onClick={function() { that.openLoginModal('') }}>New Login with Password</MenuItem>

                  <li role="separator" className="divider"></li>
                  <li className="dropdown-header">Login with PIN</li>
                  { logins.filter(this.state.context.pinExists).map(function(userName, i) {
                    return (<MenuItem onClick={function() {that.openPinModal(userName)}} key={userName}>{userName}</MenuItem>)
                  })}

                  <li role="separator" className="divider"></li>
                  <li className="dropdown-header">Login with Password</li>
                  { logins.map(function(userName, i) {
                    return (<MenuItem onClick={function() {that.openLoginModal(userName)}} key={userName}>{userName}</MenuItem>)
                  })}
                </ul>
              </li>
            );
          } else {
            loginBlock = <MenuItem onClick={function() { that.openLoginModal('') }}>Login</MenuItem>;
          }
      }
      keyBlock = ([
        <MenuItem>{this.state.apiKey}</MenuItem>,
        <MenuItem onClick={this.resetApiKey}>Reset</MenuItem>
      ]);
    } else {
      keyBlock = (
        <form className="navbar-form">
          <div className="form-group">
            <div className="input-group">
              <input ref="password" ref="apiKey" placeholder="apiKey" className="form-control" />
              <span className="input-group-btn">
                <button type="button" onClick={this.handleApiKey}  className="btn btn-primary">Start</button>
              </span>
            </div>
          </div>
        </form>
      );
    }
    return (
    <div>
      <LoginForm ref='loginModal' context={this.state.context} parentState={this} onCancel={this.closeLoginModal} onHidden={this.closeLoginModal} />
      <PinLoginForm ref='pinModal' context={this.state.context} parentState={this} onCancel={this.closePinModal} onHidden={this.closePinModal} />
      <RegistrationForm ref='signupModal' context={this.state.context} parentState={this} onCancel={this.closeSignupModal} onHidden={this.closeSignupModal} />
      <nav className="navbar navbar-default">
        <div className="container">
          <div className="navbar-header">
            <button type="button" className="navbar-toggle collapsed" data-toggle="collapse" data-target="#navbar" aria-expanded="false" aria-controls="navbar">
              <span className="sr-only">Toggle navigation</span>
              <span className="icon-bar"></span>
              <span className="icon-bar"></span>
              <span className="icon-bar"></span>
            </button>
            <a className="navbar-brand" href="#">AirbitzCore Sample</a>
          </div>
          <div id="navbar" className="navbar-collapse collapse">
            <ul className="nav navbar-nav">
            {keyBlock}
            </ul>
            <ul className="nav navbar-nav navbar-right">
              {loginBlock}
              {registrationBlock}
              {logoutBlock}
            </ul>
          </div>
        </div>
      </nav>
      <div className="container">
        {<AccountView context={this.state.context} account={this.state.account} />}
      </div>
    </div>
    );
  },
  handleApiKey: function() {
    this.setState({
        'apiKey': this.refs.apiKey.value,
        'context': abc.Context(this.refs.apiKey.value)
    });
  },
  resetApiKey: function() {
    this.setState({
        'apiKey': null,
        'context': null
    });
  },
  openLoginModal: function(username) {
    this.refs.loginModal.open(username);
  },
  closeLoginModal: function() {
    this.refs.loginModal.close();
  },
  openPinModal: function(username) {
    this.refs.pinModal.open(username);
  },
  closePinModal: function() {
    this.refs.pinModal.close();
  },
  openSignupModal: function() {
    this.refs.signupModal.open();
  },
  closeSignupModal: function() {
    this.refs.signupModal.close();
  },
  handleLogout: function() {
    this.setState({account: null});
  }
});

ReactDOM.render(<AbcApp />, document.getElementById('app'));

// vim:set ft=javascript sw=2 ts=2 et fdm=manual: 
