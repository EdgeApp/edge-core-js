'use strict';

var BootstrapButton = React.createClass({
  getInitialState: function() {
    return {'loading': false}
  },
  render: function() {
    if (this.state.loading) {
      return (<button type="button" className="btn btn-primary" disabled="disabled">
                <span className="glyphicon glyphicon-refresh glyphicon-refresh-animate"></span> {this.props.loadingMessage}
              </button>);
    } else {
      return (<button type="button" {...this.props} className="btn btn-primary">{this.props.children}</button>)
    }
  },
  setLoading: function(isLoading, callback) {
    this.setState({'loading': isLoading});
  }
});

var AbcUserList = React.createClass({
  getInitialState: function() {
    return { showInput: false };
  },
  render: function() {
    var block = null;
    var that = this;
    var context = this.props.context;
    var userList = context.usernameList().sort();
    var toggleInput = null;
    if (this.props.allowInput) {
      toggleInput = (
        <span className="input-group-btn">
          <button type="button" onClick={this.toggleInput}  className="btn btn-primary">X</button>
        </span>);
    }
    if (this.props.allowInput && (userList.length == 0 || this.state.showInput)) {
        block = (
            <div className="input-group">
              <input autoFocus ref="username" type="text" placeholder="username" className="form-control" />
              <span className="input-group-btn">
                <button type="button" onClick={this.toggleInput}  className="btn btn-primary">X</button>
              </span>
            </div>
        )
    } else {
        var selectElement = (
              <select ref="username"
                    className="form-control"
                    onChange={this.handleSelection}
                    defaultValue={this.props.username}>
                {userList.map(function(username) {
                    return (<option value={username} key={username}>{username}</option>);
                })}
              </select>
        );
        if (this.props.allowInput) {
            return (
              <div className="input-group">
                {selectElement}
                {toggleInput}
              </div>
            );
        } else {
            return selectElement;
        }
    }
    return (block);
  },
  toggleInput: function() {
    this.setState({'showInput': !this.state.showInput});
    if (this.state.showInput) {
        this.setState({username: ''});
        this.refs.username.focus();
    }
  },
  handleSelection: function() {
    this.props.onUserChange(this.refs.username.value);
  },
  getValue: function() {
    return this.refs.username.value;
  }
});

var AbcPasswordLoginForm = React.createClass({
  render: function() {
    return (
      <form className="form">
        <div className="row">
          <div className="col-sm-12">
            <div className="form-group">
              <AbcUserList
                ref="username" 
                context={this.props.context}
                allowInput={true}
                username={this.props.username}
                onUserChange={this.props.onUserChange} />
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <div className="form-group">
              <input ref="password" type="password" placeholder="Password" className="form-control" />
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12 text-center">
            <BootstrapButton ref="signin" onClick={this.handleSubmit} loadingMessage="Signing In...">Sign In</BootstrapButton>
          </div>
        </div>
      </form>
    );
  },
  handleSubmit: function() {
    var that = this;
    this.refs.signin.setLoading(true);
    this.props.context.passwordLogin(this.refs.username.getValue(), this.refs.password.value, function(err, result) {
        if (err) {
          that.props.onError(err);
        } else {
          that.props.onSuccess(result);
        }
        that.refs.signin.setLoading(false);
    });
    return false;
  }
});

var AbcPinLoginForm = React.createClass({
  render: function() {
    return (
        <form className="form">
          <div className="row">
            <div className="col-sm-12 text-center">
              <div className="form-group">
                <AbcUserList ref="username"
                    allowInput={false}
                    context={this.props.context}
                    username={this.props.username}
                    onUserChange={this.props.onUserChange} />
              </div>
            </div>
            <div className="col-sm-12 text-center">
              <div className="form-group">
                  <input ref="pin" type="password" placeholder="PIN" className="form-control" maxLength="4" />
              </div>
            </div>
          </div>
          <div className="row">
            <div className="col-sm-12 text-center">
              <div className="form-group">
                <BootstrapButton ref="signin" onClick={this.handleSubmit} loadingMessage="Signing In...">Sign In</BootstrapButton>
              </div>
            </div>
          </div>
          <div className="row">
            <div className="col-sm-12 text-center">
              <div className="form-group">
                <button type="button" onClick={this.handleExit} className="btn">Exit Pin Login</button>
              </div>
            </div>
          </div>
        </form>
    );
  },
  handleExit: function() {
    this.props.onExit();
    return false;
  },
  handleSubmit: function() {
    var that = this;
    this.refs.signin.setLoading(true);
    this.props.context.pinLogin(this.refs.username.getValue(), this.refs.pin.value, function(err, result) {
      if (err) {
        that.props.onError(err);
      } else {
        that.props.onSuccess(result);
      }
      that.refs.signin.setLoading(false);
    });
    return false;
  }
});

var AbcLoginForm = React.createClass({
  getInitialState: function() {
    return { forcePasswordLogin: false };
  },
  statics: {
    currentUser() {
        return localStorage.getItem('airbitz.current_user');
    },
    updateCurrentUser(username) {
        localStorage.setItem('airbitz.current_user', username);
    }
  },
  render: function() {
    var block = null;
    var context = this.props.context;
    var currentUser = AbcLoginForm.currentUser();
    var showPinLogin = context && currentUser && context.pinExists(currentUser) ? true : false;
    if (this.state.forcePasswordLogin) {
      showPinLogin = false;
    }
    if (showPinLogin) {
      block = (<AbcPinLoginForm ref="pinForm"
                username={currentUser}
                context={context}
                onSuccess={this.handleSuccess}
                onError={this.handleError}
                onUserChange={this.handleUserChange}
                onExit={this.handlePinExit} />);
    } else {
      block = (<AbcPasswordLoginForm ref="passwordForm"
                username={currentUser}
                context={context}
                onSuccess={this.handleSuccess}
                onError={this.handleError}
                onUserChange={this.handleUserChange} />);
    }
    return (<div>{block}</div>);
  },
  handleSuccess: function(account) {
    this.props.onSuccess(account);
    this.setState({'forcePasswordLogin': false});
    AbcLoginForm.updateCurrentUser(account.username);
  },
  handleError: function(err) {
    this.props.onError(err);
  }, 
  handlePinExit: function() {
    this.setState({'forcePasswordLogin': true});
  },
  handleUserChange: function(newUsername) {
    var context = this.props.context;
    AbcLoginForm.updateCurrentUser(newUsername);
    this.setState({'forcePasswordLogin': false});
  }
});

var AbcRegistrationForm = React.createClass({
  render: function() {
    return (
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
                  <BootstrapButton ref="register" onClick={this.handleSubmit} loadingMessage="Registering...">Register</BootstrapButton>
                </span>
              </div>
            </div>
          </div>
        </form>
    );
  },
  handleSubmit: function() {
    var that = this;
    this.refs.register.setLoading(true);
    this.props.context.accountCreate(this.refs.username.value, this.refs.password.value, function(err, result) {
        if (err) {
          that.props.onError(err);
        } else {
          var account = result;
          AbcLoginForm.updateCurrentUser(account.username);
          that.props.onSuccess(account);
          account.pinSetup(that.refs.pin.value, function(err, result) {
          });
        }
        this.refs.register.setLoading(false);
    });
    return false;
  }
});

var MenuItem = React.createClass({
  render: function() {
    return (
      <li>
        <a {...this.props} href="javascript:;" />
      </li>
    );
  }
});

var BootstrapModal = React.createClass({
  getInitialState: function() {
    return {'title': this.props.title}
  },
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
              <h4>{this.state.title}</h4>
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

var ApiKeyView = React.createClass({
  statics: {
    getApiKey: function() {
      return localStorage.getItem('airbitz.sample');
    },
    setApiKey: function(apiKey) {
      localStorage.setItem('airbitz.sample', apiKey);
    },
    clearApiKey: function() {
      localStorage.removeItem('airbitz.sample');
    }
  },
  render: function() {
    var keyBlock = null;
    if (this.props.apiKey) {
      keyBlock = ([
        <MenuItem key="key">{this.props.apiKey}</MenuItem>,
        <MenuItem key="reset" onClick={this.handleReset}>Reset</MenuItem>
      ]);
    } else {
      var keyStyle = {
        'width': '400px'
      };
      keyBlock = (
        <form className="navbar-form">
          <div className="form-group">
            <div className="input-group">
              <input ref="password" ref="apiKey" style={keyStyle} placeholder="API key" className="form-control" />
              <span className="input-group-btn">
                <button type="button" onClick={this.handleSubmit}  className="btn btn-primary">Start</button>
              </span>
            </div>
          </div>
        </form>
      );
    }
    return (
      <ul className="nav navbar-nav">
        {keyBlock}
      </ul>);
  },
  handleSubmit: function() {
    var apiKey = this.refs.apiKey.value;
    ApiKeyView.setApiKey(apiKey);
    this.props.onKeySet(this.refs.apiKey.value);
  },
  handleReset: function() {
    ApiKeyView.clearApiKey();
    this.props.onKeyReset();
  }
});

var AbcApp = React.createClass({
  getInitialState: function() {
    return { account: null };
  },
  componentDidMount: function() {
    this.handleApiKey(ApiKeyView.getApiKey());
  },
  render: function() {
    var formBlock = null, loginBlock = null, registrationBlock = null, logoutBlock = null;
    if (this.state.context) {
      if (this.state.account) {
          logoutBlock = (<MenuItem onClick={this.handleLogout}>Logout</MenuItem>);
      } else {
          registrationBlock = (<MenuItem onClick={this.openSignupModal}>Register</MenuItem>);
          loginBlock = <MenuItem onClick={this.openLoginModal}>Login</MenuItem>;
      }
      formBlock = [
        <BootstrapModal
            ref="loginModal"
            key="loginModal"
            onCancel={this.closeLoginModal}
            cancel="Cancel"
            title="Login">
            <AbcLoginForm
                context={this.state.context}
                onSuccess={this.handleLoginSuccess}
                onError={this.handleLoginError} />
        </BootstrapModal>,
        <BootstrapModal
            ref="signupModal"
            key="signupModal"
            onCancel={this.closeSignupModal}
            cancel="Cancel"
            title="Sign Up">
            <AbcRegistrationForm
              context={this.state.context}
              onSuccess={this.handleRegistrationSuccess}
              onError={this.handleRegistrationError} />
        </BootstrapModal>
      ];
    }
    return (
    <div>
      {formBlock}
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
            <ApiKeyView apiKey={this.state.apiKey} onKeySet={this.handleApiKey} onKeyReset={this.resetApiKey} />
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
  handleApiKey: function(apiKey) {
    if (apiKey) {
        this.setState({
            'apiKey': apiKey,
            'context': abc.Context(apiKey)
        });
    }
  },
  resetApiKey: function() {
    this.setState({
        'apiKey': null,
        'context': null
    });
  },
  openLoginModal: function() {
    this.refs.loginModal.open();
  },
  closeLoginModal: function() {
    this.refs.loginModal.close();
  },
  handleLoginError: function(err) {
    alert("Bummer: " + err);
  },
  handleLoginSuccess: function(account) {
    this.setState({account: account});
    this.closeLoginModal();
  },
  openSignupModal: function() {
    this.refs.signupModal.open();
  },
  closeSignupModal: function() {
    this.refs.signupModal.close();
  },
  handleRegistrationError: function(err) {
    alert("Bummer: " + err);
  },
  handleRegistrationSuccess: function(account) {
    this.setState({account: account});
    this.closeSignupModal();
  },
  handleLogout: function() {
    this.setState({account: null});
  }
});

ReactDOM.render(<AbcApp />, document.getElementById('app'));

// vim:set ft=javascript sw=2 ts=2 et fdm=manual: 
